/** R2 в памяти для тестов */
export class TestR2 implements R2Bucket {
    readonly objects = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>();

    async get(key: string): Promise<R2ObjectBody | null> {
        const object = this.objects.get(key);
        if (!object) return null;
        const bytes = object.bytes;
        return {
            key,
            size: bytes.byteLength,
            httpMetadata: { contentType: object.contentType },
            arrayBuffer: async () => bytes.slice().buffer,
            body: new Blob([bytes as BlobPart]).stream(),
        };
    }

    async put(key: string, value: ArrayBuffer | ArrayBufferView | string | ReadableStream, options?: { httpMetadata?: { contentType?: string } }) {
        let bytes: Uint8Array;
        if (typeof value === "string") bytes = new TextEncoder().encode(value);
        else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
        else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        else bytes = new Uint8Array(await new Response(value).arrayBuffer());
        this.objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
        return {};
    }

    async delete(key: string | string[]) {
        for (const item of Array.isArray(key) ? key : [key]) this.objects.delete(item);
    }
}
