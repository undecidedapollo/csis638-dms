export function keyBy(array, keyFn) {
    const result = {};
    for (const item of array) {
        const key = keyFn(item);
        result[key] = item;
    }
    return result;
}