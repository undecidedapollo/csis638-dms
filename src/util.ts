export function keyBy(array, keyFn) {
    const result = {};
    for (const item of array) {
        const key = keyFn(item);
        result[key] = item;
    }
    return result;
}

export class ComplexKeyMap<K extends object, V> implements Map<K, V> {
    private stringMap = new Map<string, V>();
    private keyMap = new Map<string, K>(); // To store the original keys

    public static fromEntries<K extends object, V>(entries: Array<[key: K, value: V]>): ComplexKeyMap<K, V> {
        const complexKeyMap = new ComplexKeyMap<K, V>();
        for (const entry of entries) {
            const [key, value] = entry;
            complexKeyMap.set(key, value);
        }
        return complexKeyMap;
    }

    private getKey(key: K): string {
        // Ensure consistent key order for serialization
        const sortedKey = Object.keys(key).sort().reduce(
            (acc, curr) => {
                acc[curr] = (key as any)[curr];
                return acc;
            }, {} as any
        );
        return JSON.stringify(sortedKey);
    }

    set(key: K, value: V): this {
        const stringKey = this.getKey(key);
        this.stringMap.set(stringKey, value);
        this.keyMap.set(stringKey, key); // Store the original key
        return this;
    }

    get(key: K): V | undefined {
        return this.stringMap.get(this.getKey(key));
    }

    has(key: K): boolean {
        return this.stringMap.has(this.getKey(key));
    }

    delete(key: K): boolean {
        const stringKey = this.getKey(key);
        this.keyMap.delete(stringKey);
        return this.stringMap.delete(stringKey);
    }

    clear(): void {
        this.stringMap.clear();
        this.keyMap.clear();
    }

    get size(): number {
        return this.stringMap.size;
    }

    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
        for (const [stringKey, value] of this.stringMap.entries()) {
            const originalKey = this.keyMap.get(stringKey)!;
            callbackfn.call(thisArg, value, originalKey, this);
        }
    }

    *entries(): IterableIterator<[K, V]> {
        for (const [stringKey, value] of this.stringMap.entries()) {
            const originalKey = this.keyMap.get(stringKey)!;
            yield [originalKey, value];
        }
    }

    *keys(): IterableIterator<K> {
        for (const originalKey of this.keyMap.values()) {
            yield originalKey;
        }
    }

    *values(): IterableIterator<V> {
        for (const value of this.stringMap.values()) {
            yield value;
        }
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries();
    }

    public get [Symbol.toStringTag](): string {
        return 'ComplexKeyMap';
    }
}
