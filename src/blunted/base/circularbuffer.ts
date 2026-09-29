// Replacement for boost::circular_buffer<T>: fixed capacity, push_back drops the oldest element.

export class CircularBuffer<T> {
  protected items: T[] = [];

  constructor(protected capacity: number) {}

  set_capacity(capacity: number): void {
    this.capacity = capacity;
    while (this.items.length > capacity) this.items.shift();
  }

  get length(): number {
    return this.items.length;
  }

  size(): number {
    return this.items.length;
  }

  empty(): boolean {
    return this.items.length === 0;
  }

  full(): boolean {
    return this.items.length >= this.capacity;
  }

  push_back(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  push_front(item: T): void {
    this.items.unshift(item);
    if (this.items.length > this.capacity) this.items.pop();
  }

  pop_front(): T | undefined {
    return this.items.shift();
  }

  pop_back(): T | undefined {
    return this.items.pop();
  }

  /** C++ at(i) / operator[] */
  at(i: number): T {
    return this.items[i];
  }

  set(i: number, item: T): void {
    this.items[i] = item;
  }

  front(): T {
    return this.items[0];
  }

  back(): T {
    return this.items[this.items.length - 1];
  }

  clear(): void {
    this.items = [];
  }

  toArray(): T[] {
    return this.items.slice();
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }
}
