declare module 'lua-json' {
  /**
   * Convert Lua table format to JSON.
   * @param luaString - Lua table string to convert
   * @returns Parsed JavaScript object
   */
  export function parse(luaString: string): any;

  /**
   * Convert JavaScript object to Lua table format.
   * @param obj - JavaScript object to convert
   * @returns Lua table string
   */
  export function stringify(obj: any): string;
} 