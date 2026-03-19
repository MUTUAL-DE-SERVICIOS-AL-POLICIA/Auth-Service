# Auth-Service

## Descripción

**Auth-Service** es el microservicio encargado de la autenticación y autorización de usuarios en la plataforma. Gestiona todo el proceso de login, validación de credenciales, generación de tokens de acceso y control de permisos. Es el servicio central que garantiza que solo usuarios autorizados accedan a los recursos de la plataforma.

Maneja datos como:
- Autenticación de usuarios (login y logout)
- Validación de credenciales contra LDAP
- Generación y validación de tokens JWT
- Gestión de permisos y roles de usuarios
- Control de acceso a recursos
- Gestión de sesiones seguras


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

# Para enlazar a un nuevo repositorio
git remote add origin https://github.com/tu-usuario/{nombre-auth-service}.git
git add .
git commit -m "Inicialización del nuevo proyecto"
git branch -M main
git push -u origin main
```

