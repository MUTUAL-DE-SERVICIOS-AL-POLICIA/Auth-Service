# Auth-Service

## Descripción

**Auth-Service** es el microservicio encargado de la autenticación y autorización de usuarios en la plataforma. Gestiona todo el proceso de login, validación de credenciales, generación de tokens de acceso y control de permisos. Es el servicio central que garantiza que solo usuarios autorizados accedan a los recursos de la plataforma. Forma parte de una arquitectura de microservicios basada en **NestJS** y utiliza **NATS** para la comunicación asincrónica entre servicios.

Maneja datos como:
- Autenticación de usuarios (login y logout)
- Validación de credenciales contra LDAP
- Generación y validación de tokens JWT
- Gestión de permisos y roles de usuarios
- Control de acceso a recursos
- Gestión de sesiones seguras

---

## Estructura del Proyecto

```
src/
├── app.module.ts                 # Módulo raíz que organiza todos los módulos de la aplicación
├── main.ts                       # Punto de entrada principal de la aplicación
├── auth/                         # Módulo principal de autenticación
│   ├── controllers/              # Controladores que manejan rutas de login/logout
│   ├── services/                 # Servicios con la lógica de autenticación
│   └── dto/                      # Data Transfer Objects para validación de credenciales
├── ldap/                         # Módulo de integración con servidor LDAP
│   ├── ldap.service.ts           # Servicio para validar usuarios contra LDAP
│   └── ldap.config.ts            # Configuración de conexión LDAP
├── jwt/                          # Módulo de gestión de tokens JWT
│   ├── jwt.strategy.ts           # Estrategia de Passport para validar JWTs
│   └── jwt.service.ts            # Servicio para generar y validar tokens
├── common/                       # Código compartido reutilizable en toda la aplicación
│   ├── filters/                  # Filtros para manejo de excepciones
│   ├── guards/                   # Guards para proteger rutas
│   └── decorators/               # Decoradores personalizados
├── config/                       # Archivos de configuración (BD, variables ENV, etc)
│   └── database.config.ts        # Configuración específica de PostgreSQL
├── database/                     # Gestión de base de datos, migraciones y datos iniciales
│   ├── migrations/               # Migraciones TypeORM para cambios en el esquema BD
│   ├── seeds/                    # Seeders para llenar BD con datos de prueba
│   └── entities/                 # Entidades (modelos) que representan tablas de la BD
```

---

## Clonar el repositorio y agregarle un nombre nuevo del nuevo proyecto

```bash
git clone https://github.com/MUTUAL-DE-SERVICIOS-AL-POLICIA/Auth-Service.git nombre-auth-service
```

## Inicializar proyecto

```bash
# Entrar al repositorio clonado con el nuevo nombre del proyecto
cd nombre-auth-service

# Elimina el origen remoto actual
git remote remove origin

# Crear el archivo .env en base al .env.template
cp .env.template .env

# Instalar las dependencias
pnpm install

# Correr proyecto en modo desarrollo
pnpm start:dev

# Crear nuevo Módulo
nest g res nombreModulo

# Crear una migración
pnpm typeorm migration:create src/database/migrations/NombreDeLaMigración

# Correr migración
pnpm migration:run

# Revertir migración
pnpm migration:revert

# Ver estado de migraciones
pnpm migration:show

# Para enlazar a un nuevo repositorio
git remote add origin https://github.com/tu-usuario/{nombre-auth-service}.git
git add .
git commit -m "Inicialización del nuevo proyecto"
git branch -M main
git push -u origin main
```

