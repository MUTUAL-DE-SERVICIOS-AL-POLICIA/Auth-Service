import { Injectable, Logger } from '@nestjs/common';
import * as ldap from 'ldapjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/user/entities/user.entity';

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);
  private client: ldap.Client;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.initializeLdapClient();
  }

  /**
   * Inicializa el cliente LDAP con la configuración del servidor
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
   * Retorna los usuarios del LDAP que NO existen en la base de datos
   */
  async getAllUsers(): Promise<
    {
      username: string;
      firstName: string;
      lastName: string;
      position: string;
    }[]
  > {
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

      // 1. Conectar al servidor LDAP
      this.client.bind(
        `cn=${adminUsername},${baseDN}`,
        adminPassword,
        async (err) => {
          if (err) {
            this.logger.error('LDAP Bind Error:', err);
            reject(err);
            return;
          }

          const ldapUsers: any[] = [];

          // 2. Buscar todos los usuarios en el LDAP
          this.client.search(baseDN, searchOptions, async (err, res) => {
            if (err) {
              this.logger.error('LDAP Search Error:', err);
              reject(err);
              return;
            }

            res.on('searchEntry', (entry) => {
              const userData = entry.attributes.reduce((acc, attr) => {
                acc[attr.type] = attr.vals[0];
                return acc;
              }, {} as any);

              if (userData.uid) {
                // Transformar los datos al nuevo formato
                ldapUsers.push({
                  username: userData.uid,
                  firstName: userData.givenName || '',
                  lastName: userData.sn || '',
                  position: userData.title || '',
                });
              }
            });

            res.on('error', (err) => {
              this.logger.error('LDAP Search Error:', err);
              reject(err);
            });

            res.on('end', async () => {
              try {
                // 3. Obtener todos los usernames locales
                const localUsernames = (
                  await this.userRepository.find({ select: ['username'] })
                ).map((user) => user.username);

                // 4. Filtrar los LDAP users que NO están en la tabla auth.users
                const usersNotInDatabase = ldapUsers.filter(
                  (ldapUser) => !localUsernames.includes(ldapUser.username),
                );

                // 5. Ordenar por username
                usersNotInDatabase.sort((a, b) =>
                  a.username.localeCompare(b.username),
                );

                resolve(usersNotInDatabase);
              } catch (dbErr) {
                this.logger.error('Database Query Error:', dbErr);
                reject(dbErr);
              }
            });
          });
        },
      );
    });
  }
}
