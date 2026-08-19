export class DomainError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
  }
}
