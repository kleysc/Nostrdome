declare module '../utils/nostr' {
  export const publishSignedEvent: (
    pool: any,
    event: Partial<any>,
    privateKey: string
  ) => Promise<void>;

  export const fileToBase64: (file: File) => Promise<string>;
} 