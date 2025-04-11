import { Injectable, Logger } from '@nestjs/common';
import * as ldap from 'ldapjs';

/**
 * Servicio para interactuar con el servidor LDAP
 * Este servicio maneja la conexión y las operaciones con el servidor LDAP
 */
@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);
  private client: ldap.Client;

  constructor() {
    this.initializeLdapClient();
  }

  /**
   * Inicializa el cliente LDAP con la configuración del servidor
   * Configura la URL del servidor y maneja los eventos de error
   */
  private initializeLdapClient() {
    const host = process.env.LDAP_HOST;
    const port = parseInt(process.env.LDAP_PORT);

    this.client = ldap.createClient({
      url: `ldap://${host}:${port}`,
    });

    this.client.on('error', (err) => {
      this.logger.error('LDAP Client Error:', err);
    });
  }

  /**
   * Obtiene todos los usuarios del LDAP
   * @returns Promise con la lista de usuarios encontrados
   */
  async getAllUsers() {
    return new Promise((resolve, reject) => {
      const adminUsername = process.env.LDAP_ADMIN_USERNAME;
      const adminPassword = process.env.LDAP_ADMIN_PASSWORD;
      const baseDN = process.env.LDAP_BASEDN;
      const accountPrefix = process.env.LDAP_ACCOUNT_PREFIX;

      const searchOptions: ldap.SearchOptions = {
        filter: `(${accountPrefix}=*)`,
        scope: 'sub',
        attributes: ['uid', 'givenName', 'sn', 'title'],
      };

      // Autenticación con credenciales de administrador
      this.client.bind(
        `cn=${adminUsername},${baseDN}`,
        adminPassword,
        (err) => {
          if (err) {
            this.logger.error('LDAP Bind Error:', err);
            reject(err);
            return;
          }

          const users: any[] = [];

          // Búsqueda de usuarios
          this.client.search(baseDN, searchOptions, (err, res) => {
            if (err) {
              this.logger.error('LDAP Search Error:', err);
              reject(err);
              return;
            }

            // Procesamiento de los resultados
            res.on('searchEntry', (entry) => {
              const userData = entry.attributes.reduce((acc, attr) => {
                acc[attr.type] = attr.vals[0];
                return acc;
              }, {} as any);

              if (userData.uid) {
                // Transformar los datos al nuevo formato
                const user = {
                  username: userData.uid,
                  firstName: userData.givenName || '',
                  lastName: userData.sn || '',
                  position: userData.title || '',
                };
                users.push(user);
              }
            });

            res.on('error', (err) => {
              this.logger.error('LDAP Search Error:', err);
              reject(err);
            });

            res.on('end', () => {
              // Ordenar usuarios por username
              const sortedUsers = users.sort((a, b) =>
                a.username.localeCompare(b.username),
              );
              resolve(sortedUsers);
            });
          });
        },
      );
    });
  }
}
