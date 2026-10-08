// Bara för typkontrollen i Node (tsc): funktionerna körs i Deno, som har de här globala objekten inbyggda.
declare namespace Deno {
  export const env: { get(key: string): string | undefined };
  export function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
