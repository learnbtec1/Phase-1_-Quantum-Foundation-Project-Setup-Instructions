declare module 'mammoth' {
  export interface ConvertToHtmlOptions {
    styleMap?: string[];
    includeDefaultStyleMap?: boolean;
  }
  export function convertToHtml(
    input: ArrayBuffer | { arrayBuffer: () => Promise<ArrayBuffer> },
    options?: ConvertToHtmlOptions
  ): Promise<{ value: string; messages: string[] }>;
  const _default: any;
  export default _default;
}