import { Injectable, Logger } from '@nestjs/common';
import { NatsService } from 'src/common';
import { RpcException } from '@nestjs/microservices';
import { TestDeviceEnvs } from 'src/config';

@Injectable()
export class AuthAppMobileService {
  private readonly logger = new Logger('AuthService');
  constructor(private readonly nats: NatsService) {}

  async loginAppMobile(body: any): Promise<any> {
    const {
      username,
      cellphone,
      signature,
      firebaseToken,
      isBiometric,
      isRegisterCellphone,
    } = body;
    let directAccess = false;
    if (
      TestDeviceEnvs.userTestDevice === username &&
      TestDeviceEnvs.userTestAccess === true
    ) {
      directAccess = true;
    }
    const validatePersonSms = await this.nats.firstValue(
      'person.validatePersonSms',
      {
        identityCard: username,
        cellphone,
        isRegisterCellphone,
        directAccess,
      },
    );

    if (!validatePersonSms.serviceStatus)
      throw new RpcException({
        message: 'Error en el servicio person.validatePersonSms',
        code: 401,
      });
    if (!validatePersonSms.validateStatus) {
      return {
        error: !validatePersonSms.validateStatus,
        message: validatePersonSms.message,
      };
    }

    const { person } = validatePersonSms;

    const validateWhoIsThePerson = await this.nats.firstValue(
      'person.validateWhoIsThePerson',
      { personId: person.id },
    );
    const { affiliateId, isPolice, serviceStatus } = validateWhoIsThePerson;

    if (!serviceStatus)
      throw new RpcException({
        message: 'Error en el servicio person.validateWhoIsThePerson',
        code: 401,
      });
    if (!validateWhoIsThePerson.validateStatus) {
      return {
        error: !validateWhoIsThePerson.validateStatus,
        message: validateWhoIsThePerson.message,
      };
    }

    let affiliate = null;
    affiliate = await this.nats.firstValueInclude(
      { affiliateId: affiliateId },
      'affiliate.findOneData',
      ['degree', 'category', 'affiliateState'],
    );

    const { id, name } = affiliate.affiliateState;

    if (id != 4 && name != 'Fallecido' && !isPolice) {
      return {
        error: true,
        message:
          'La persona titular no se encuentra fallecida, pasar por oficinas de la MUSERPOL',
      };
    }

    const pensionEntityId = isPolice
      ? person.pensionEntityId
      : validateWhoIsThePerson.pensionEntityId;
    let pensionEntities = null;

    const validateBeneficiaryEcoCom = await this.nats.firstValue(
      'pvtBe.validateBeneficiaryEcoCom',
      { identityCard: person.identityCard },
    );
    if (!validateBeneficiaryEcoCom.serviceStatus)
      throw new RpcException({
        message: 'Error en el servicio pvtBe.validateBeneficiaryEcoCom',
        code: 401,
      });

    const { message: messageEcoCom, data: dataEcoCom } =
      validateBeneficiaryEcoCom;

    if (!affiliate.serviceStatus)
      throw new RpcException({
        message: 'Error al obtener los datos del afiliado',
        code: 401,
      });
    pensionEntities = await this.nats.firstValueInclude(
      { id: pensionEntityId },
      'pensionEntities.findOne',
      ['name'],
    );

    const degree = affiliate.degree;
    const category = affiliate.category;
    const kinship = await this.nats.firstValueInclude(
      { id: validateWhoIsThePerson.kinshipId },
      'kinships.findOne',
      ['name'],
    );
    const fullName = (
      (person.firstName ?? '') +
      ' ' +
      (person.lastName ?? '') +
      ' ' +
      (person.mothersLastName ?? '') +
      ' ' +
      (person.secondName ?? '') +
      ' ' +
      (person.surnameHusband ?? '')
    ).trim();
    const { apiToken, tokenId } = await this.nats.firstValue(
      'appMobile.refreshToken',
      { affiliateId, firebaseToken },
    );
    const { enrolled, verified } = await this.nats.firstValue(
      'appMobile.verifyDevice',
      { tokenId },
    );
    const data = {
      apiToken,
      information: {
        fullName,
        identityCard: person.identityCard,
        isPolice,
        kinship: kinship?.serviceStatus ? kinship.name : 's/n',
        affiliateId,
        pensionEntity: pensionEntities?.serviceStatus
          ? pensionEntities.name
          : 's/n',
        degree: degree?.name ?? 's/n',
        category: category?.name ?? 's/n',
        isDoblePerception: dataEcoCom.isDoblePerception,
        isEconomicComplement: dataEcoCom.isEconomicComplement,
        messageEcoCom,
        enrolled,
        verified,
      },
    };
    if (directAccess) {
      return {
        error: false,
        message: validateWhoIsThePerson.message + ' Login de prueba',
        data,
      };
    }
    if (isBiometric) {
      this.logger.log('Login AppMobile con huella dactilar');
      return {
        error: false,
        message:
          validateWhoIsThePerson.message + ' Login mediante huella dactilar',
        data,
      };
    }
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    const messageSend = `Tu pin de seguridad es: ${pin}\n#muserpolpvt ${signature}`;
    const cellphoneCodePostal = `591${cellphone}`;
    data.information['pin'] = pin;
    const { status, message, messageId } = await this.nats.firstValue(
      'sms.send',
      { cellphone: cellphoneCodePostal, message: messageSend },
    );
    await this.nats.firstValue('ftp.saveDataTmp', {
      path: 'appMobileAuth',
      name: messageId,
      data: data,
    });
    this.logger.log('Login AppMobile con envío de sms');
    return {
      error: !status,
      message: message + ' Login mediante SMS',
      messageId,
    };
  }

  async verifyPin(body: any): Promise<any> {
    const { pin, messageId } = body;

    const data = await this.nats.firstValue('ftp.getDataTmp', {
      path: 'appMobileAuth',
      name: messageId,
    });

    if (!data) {
      return {
        error: true,
        message: 'Vuelva a intentarlo, regenere el código de verificación',
      };
    }

    // DESCOMENTAR CUANDO SE SOLUCIONE BUG EN LA APP MOVIL DE VERIFICACION AL AUTOCOMPLETAR
    // if (!data.information || typeof data.information.pin === 'undefined') {
    //   return {
    //     error: true,
    //     message: 'El pin ha expirado, vuelva a iniciar sesión',
    //   };
    // }

    const { pin: expectedPin, ...information } = data.information;

    if (pin !== expectedPin) {
      return {
        error: true,
        message: 'Pin incorrecto',
      };
    }

    return {
      error: false,
      message: 'Pin verificado, Inicio de sesión con envío de sms',
      data: {
        apiToken: data.apiToken,
        information,
      },
    };
  }

  async verifyApiTokenAppMobile(body: any): Promise<any> {
    return await this.nats.firstValue('appMobile.verifyToken', body);
  }

  async logoutAppMobile(body: any): Promise<any> {
    return await this.nats.firstValue('appMobile.deleteToken', body);
  }
}
