/** O motoboy. Pertence à loja (ADR-0009), não à plataforma. */

export interface Driver {
  id: string;
  name: string;
  phone?: string;
  password?: string;
  bikeModel?: string;
  plate?: string;
  active: boolean;
  online?: boolean;
  lat?: number;
  lng?: number;
  /** Quando `lat`/`lng` foram tirados. Ver `locationFreshness` em `driverLocation.ts`. */
  locationAt?: string;
  createdAt: string;
}
