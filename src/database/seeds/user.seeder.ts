import { Seeder } from 'typeorm-extension';
import { DataSource } from 'typeorm';
import { User } from 'src/user/entities/user.entity';
import * as crypto from 'crypto';

export default class UserSeeder implements Seeder {
  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(User);

    //pendiente normalizar el position

    // Consulta los usuarios directamente desde el schema public
    const rawUsers = await dataSource.query(`
      SELECT 
        username,
        first_name,
        last_name,
        position,
        created_at
      FROM public.users
    `);

    // Verifica si hay datos válidos
    if (!rawUsers.length) {
      console.log('No se encontraron usuarios válidos en public.users');
      return;
    }

    // Transforma los datos a la entidad auth.users
    const parsedUsers = rawUsers.map((user: any) =>
      repo.create({
        username: user.username,
        name: `${user.first_name} ${user.last_name}`,
        position: user.position,
        createdAt: new Date(user.created_at),
        uuid: crypto.randomUUID(),
      }),
    );

    await repo.save(parsedUsers);
    console.log(`${parsedUsers.length} usuarios insertados en auth.users`);
  }
}
