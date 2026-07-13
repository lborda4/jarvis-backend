import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({
      where: { email: email.trim().toLowerCase() },
    });
  }

  create(data: Pick<User, 'name' | 'email' | 'password' | 'active'>): User {
    return this.repository.create({
      ...data,
      email: data.email.trim().toLowerCase(),
    });
  }

  save(user: User): Promise<User> {
    return this.repository.save(user);
  }
}
