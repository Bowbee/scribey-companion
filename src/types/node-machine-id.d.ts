declare module 'node-machine-id' {
  /**
   * Get unique machine id of the host (sync).
   * @param original - If true, returns original machine id; if false, returns hash of machine id.
   * @returns The machine id string.
   */
  export function machineIdSync(original?: boolean): string;

  /**
   * Get unique machine id of the host (async).
   * @param original - If true, returns original machine id; if false, returns hash of machine id.
   * @returns Promise that resolves to the machine id string.
   */
  export function machineId(original?: boolean): Promise<string>;
} 