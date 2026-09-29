// Replacement for boost::circular_buffer<T>: fixed capacity, push_back drops the oldest element.
// Implemented as a ring (O(1) push/pop at both ends); index 0 is always the oldest element.

export class CircularBuffer<T> {
  protected items: (T | undefined)[];
  protected start = 0;
  protected count = 0;

  constructor(protected capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.items = new Array<T | undefined>(this.capacity);
  }

  set_capacity(capacity: number): void {
    const kept = this.toArray();
    this.capacity = Math.max(0, Math.floor(capacity));
    this.items = new Array<T | undefined>(this.capacity);
    this.start = 0;
    this.count = 0;
    for (const item of kept.slice(Math.max(0, kept.length - this.capacity))) this.push_back(item);
  }

  get length(): number {
    return this.count;
  }

  size(): number {
    return this.count;
  }

  empty(): boolean {
    return this.count === 0;
  }

  full(): boolean {
    return this.count >= this.capacity;
  }

  protected slot(i: number): number {
    return (this.start + i) % this.capacity;
  }

  push_back(item: T): void {
    if (this.capacity === 0) return;
    if (this.count < this.capacity) {
      this.items[this.slot(this.count)] = item;
      this.count++;
    } else {
      this.items[this.start] = item;
      this.start = (this.start + 1) % this.capacity;
    }
  }

  push_front(item: T): void {
    if (this.capacity === 0) return;
    this.start = (this.start - 1 + this.capacity) % this.capacity;
    this.items[this.start] = item;
    if (this.count < this.capacity) this.count++;
  }

  pop_front(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.items[this.start];
    this.items[this.start] = undefined;
    this.start = (this.start + 1) % this.capacity;
    this.count--;
    return item;
  }

  pop_back(): T | undefined {
    if (this.count === 0) return undefined;
    const s = this.slot(this.count - 1);
    const item = this.items[s];
    this.items[s] = undefined;
    this.count--;
    return item;
  }

  /** C++ at(i) / operator[] */
  at(i: number): T {
    return this.items[this.slot(i)] as T;
  }

  set(i: number, item: T): void {
    this.items[this.slot(i)] = item;
  }

  front(): T {
    return this.at(0);
  }

  back(): T {
    return this.at(this.count - 1);
  }

  clear(): void {
    this.items = new Array<T | undefined>(this.capacity);
    this.start = 0;
    this.count = 0;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.at(i));
    return out;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.count; i++) yield this.at(i);
  }
}
