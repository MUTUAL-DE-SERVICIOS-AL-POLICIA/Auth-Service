import { Seeder } from 'typeorm-extension';
import { DataSource } from 'typeorm';
import { Permision } from 'src/user/entities/permision.entity';

export default class PermisionSeeder implements Seeder {
  async run(dataSource: DataSource): Promise<void> {
    const permisionRepository = dataSource.getRepository(Permision);

    console.log('Verificando permisos existentes...');

    const existing = await permisionRepository.count();
    if (existing > 0) {
      console.log(
        `Se encontraron ${existing} permisos existentes. Se omite la inserción.`,
      );
      return;
    }
    const staticPermisions = [
      // Auth
      {
        name: 'iniciar sesión',
        text1: 'Iniciar sesión',
        text2: 'Permite autenticarse en el sistema.',
      },
      {
        name: 'cerrar sesión',
        text1: 'Cerrar sesión',
        text2: 'Permite finalizar la sesión del usuario.',
      },
      {
        name: 'obtener usuarios LDAP',
        text1: 'Ver Usuarios LDAP',
        text2: 'Permite visualizar la lista de usuarios LDAP.',
      },

      // Persons
      {
        name: 'ver listado de huellas',
        text1: 'Ver listado de huellas',
        text2: 'Permite ver la lista de huellas registradas.',
      },
      {
        name: 'ver personas',
        text1: 'Ver Personas',
        text2: 'Permite visualizar la lista de personas.',
      },
      {
        name: 'crear persona',
        text1: 'Crear Persona',
        text2: 'Permite registrar una nueva persona.',
      },
      {
        name: 'buscar persona',
        text1: 'Buscar Persona',
        text2: 'Permite buscar una persona específica por término.',
      },
      {
        name: 'actualizar persona',
        text1: 'Actualizar Persona',
        text2: 'Permite modificar los datos de una persona.',
      },
      {
        name: 'eliminar persona',
        text1: 'Eliminar Persona',
        text2: 'Permite eliminar una persona del sistema.',
      },
      {
        name: 'ver afiliaciones de persona',
        text1: 'Ver Afiliaciones de Persona',
        text2:
          'Permite ver los detalles de afiliación relacionados a la persona.',
      },
      {
        name: 'ver personas relacionadas',
        text1: 'Ver Personas Relacionadas',
        text2: 'Permite ver las personas relacionadas a un afiliado.',
      },
      {
        name: 'ver afiliado relacionado',
        text1: 'Ver Afiliado Relacionado',
        text2: 'Permite ver afiliado relacionado a una persona.',
      },
      {
        name: 'registrar huella',
        text1: 'Registrar Huella',
        text2: 'Permite registrar una nueva huella para una persona.',
      },
      {
        name: 'ver huella de persona',
        text1: 'Ver Huella de Persona',
        text2: 'Permite visualizar la huella registrada de una persona.',
      },

      // ProcedureDocuments
      {
        name: 'ver documentos de trámite',
        text1: 'Ver Documentos de Trámite',
        text2: 'Permite ver todos los documentos de trámite.',
      },
      {
        name: 'ver documento de trámite',
        text1: 'Ver Documento de Trámite',
        text2: 'Permite ver un documento de trámite específico.',
      },

      // Category
      {
        name: 'ver categorías',
        text1: 'Ver Categorías',
        text2: 'Permite ver todas las categorías registradas.',
      },
      {
        name: 'ver categoría',
        text1: 'Ver Categoría',
        text2: 'Permite ver una categoría específica.',
      },

      // City
      {
        name: 'ver ciudades',
        text1: 'Ver Ciudades',
        text2: 'Permite ver todas las ciudades registradas.',
      },
      {
        name: 'ver ciudad',
        text1: 'Ver Ciudad',
        text2: 'Permite ver una ciudad específica.',
      },

      // Degree
      {
        name: 'ver grados',
        text1: 'Ver Grados',
        text2: 'Permite ver todos los grados registrados.',
      },
      {
        name: 'ver grado',
        text1: 'Ver Grado',
        text2: 'Permite ver un grado específico.',
      },

      // Hierarchy
      {
        name: 'ver jerarquías',
        text1: 'Ver Jerarquías',
        text2: 'Permite ver todas las jerarquías registradas.',
      },
      {
        name: 'ver jerarquía',
        text1: 'Ver Jerarquía',
        text2: 'Permite ver una jerarquía específica.',
      },

      // FinancialEntity
      {
        name: 'ver entidades financieras',
        text1: 'Ver Entidades Financieras',
        text2: 'Permite ver todas las entidades financieras.',
      },
      {
        name: 'ver entidad financiera',
        text1: 'Ver Entidad Financiera',
        text2: 'Permite ver una entidad financiera específica.',
      },

      // Kinship
      {
        name: 'ver parentescos',
        text1: 'Ver Parentescos',
        text2: 'Permite ver todos los tipos de parentesco registrados.',
      },
      {
        name: 'ver parentesco',
        text1: 'Ver Parentesco',
        text2: 'Permite ver un tipo de parentesco específico.',
      },

      // PensionEntity
      {
        name: 'ver entidades de pensión',
        text1: 'Ver Entidades de Pensión',
        text2: 'Permite ver todas las entidades de pensión registradas.',
      },
      {
        name: 'ver entidad de pensión',
        text1: 'Ver Entidad de Pensión',
        text2: 'Permite ver una entidad de pensión específica.',
      },

      // Unit
      {
        name: 'ver unidades',
        text1: 'Ver Unidades',
        text2: 'Permite ver todas las unidades registradas.',
      },
      {
        name: 'ver unidad',
        text1: 'Ver Unidad',
        text2: 'Permite ver una unidad específica.',
      },

      // Breakdown
      {
        name: 'ver desgloses',
        text1: 'Ver Desgloses',
        text2: 'Permite ver todos los desgloses registrados.',
      },
      {
        name: 'ver desglose',
        text1: 'Ver Desglose',
        text2: 'Permite ver un desglose específico.',
      },

      // Module
      {
        name: 'ver módulos',
        text1: 'Ver Módulos',
        text2: 'Permite ver todos los módulos del sistema.',
      },
      {
        name: 'ver módulo',
        text1: 'Ver Módulo',
        text2: 'Permite ver un módulo específico.',
      },

      // Procedure Types
      {
        name: 'ver tipos de trámite',
        text1: 'Ver Tipos de Trámite',
        text2: 'Permite ver todos los tipos de trámite disponibles.',
      },
      {
        name: 'ver tipo de trámite',
        text1: 'Ver Tipo de Trámite',
        text2: 'Permite ver un tipo de trámite específico.',
      },

      // Procedure Modalities
      {
        name: 'ver modalidades de trámite',
        text1: 'Ver Modalidades de Trámite',
        text2: 'Permite ver todas las modalidades de trámite disponibles.',
      },
      {
        name: 'ver modalidad de trámite',
        text1: 'Ver Modalidad de Trámite',
        text2: 'Permite ver una modalidad de trámite específica.',
      },

      // Affiliates
      {
        name: 'ver afiliado',
        text1: 'Ver Afiliado',
        text2: 'Permite ver la información de un afiliado.',
      },
      {
        name: 'subir documento de afiliado',
        text1: 'Subir Documento de Afiliado',
        text2: 'Permite enlazar y subir un documento al afiliado.',
      },
      {
        name: 'ver documentos de afiliado',
        text1: 'Ver Documentos de Afiliado',
        text2: 'Permite ver los documentos asociados al afiliado.',
      },
      {
        name: 'ver documento específico del afiliado',
        text1: 'Ver Documento Específico',
        text2: 'Permite ver un documento específico del afiliado.',
      },
      {
        name: 'ver comparación de modalidad',
        text1: 'Ver Comparación de Modalidad',
        text2: 'Permite verificar comparación de modalidad del afiliado.',
      },
      {
        name: 'analizar documentos',
        text1: 'Analizar Documentos',
        text2: 'Permite ejecutar el análisis de documentos del afiliado.',
      },
      {
        name: 'importar documentos',
        text1: 'Importar Documentos',
        text2: 'Permite importar múltiples documentos del afiliado.',
      },

      // Kiosk
      {
        name: 'buscar persona por cédula',
        text1: 'Buscar Persona por Cédula',
        text2: 'Permite obtener datos de persona por cédula en kiosko.',
      },
      {
        name: 'guardar datos de kiosko',
        text1: 'Guardar Datos Kiosko',
        text2: 'Permite guardar los datos ingresados en el kiosko.',
      },
      {
        name: 'guardar fotografía en kiosko',
        text1: 'Guardar Fotografía',
        text2: 'Permite subir la foto capturada desde el kiosko.',
      },
      {
        name: 'comparar huella',
        text1: 'Comparar Huella',
        text2: 'Permite obtener resultado de comparación de huella digital.',
      },
      {
        name: 'ver ecoCom por cédula',
        text1: 'Ver ecoCom por Cédula',
        text2: 'Permite ver los datos ecoCom vinculados a una cédula.',
      },
      {
        name: 'ver ecoCom por id',
        text1: 'Ver ecoCom por ID',
        text2: 'Permite ver un ecoCom específico por ID.',
      },
      {
        name: 'crear ecoCom',
        text1: 'Crear ecoCom',
        text2: 'Permite crear un nuevo registro ecoCom.',
      },
      {
        name: 'ver trámites por cédula',
        text1: 'Ver Trámites por Cédula',
        text2: 'Permite consultar los trámites disponibles por cédula.',
      },
    ];

    await permisionRepository.save(staticPermisions);
    console.log('¡Permisos insertados correctamente!');
  }
}
