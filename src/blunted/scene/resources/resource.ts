// Port of blunted/types/resource: a named, shared resource wrapper.

export class Resource<T> {
  resource: T;
  protected readonly identString: string;

  constructor(identString: string, resource: T) {
    this.identString = identString;
    this.resource = resource;
  }

  GetResource(): T {
    return this.resource;
  }

  GetIdentString(): string {
    return this.identString;
  }
}
