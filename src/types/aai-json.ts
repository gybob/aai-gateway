export interface AaiJson {
  schema_version: "1.0";
  version: string;
  platform: "macos" | "linux" | "windows" | "web";
  app: {
    id: string;
    name: string;
    description: string;
  };
  execution: {
    type: "ipc" | "http";
    base_url?: string;
    default_headers?: Record<string, string>;
  };
  auth?: {
    type: "oauth2";
    oauth2: {
      authorization_endpoint: string;
      token_endpoint: string;
      scopes: string[];
      pkce: { method: "S256" };
    };
  };
  tools: Array<{
    name: string;
    description: string;
    parameters: object;
    returns?: object;
    execution?: {
      path: string;
      method: string;
      headers?: Record<string, string>;
    };
  }>;
}

export interface DiscoveredDesktopApp {
  bundlePath: string;
  appId: string;
  name: string;
  description: string;
  descriptor: AaiJson;
}
