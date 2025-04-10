import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { LdapService } from '../ldap/ldap.service';

/**
 * Controlador para manejar las operaciones LDAP en el microservicio de autenticación
 * Este controlador recibe mensajes a través de NATS y utiliza el LdapService para interactuar con el servidor LDAP
 */
@Controller()
export class LdapController {
  constructor(private readonly ldapService: LdapService) {}

  /**
   * Maneja la solicitud para obtener todos los usuarios LDAP
   * @returns Lista de usuarios encontrados en LDAP
   */
  @MessagePattern('auth.ldap.getAllUsers')
  async getAllUsers() {
    try {
      return await this.ldapService.getAllUsers();
    } catch (error) {
      throw error;
    }
  }
}
