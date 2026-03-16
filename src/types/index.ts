export type DatabaseType = 'MSSQL' | 'MySQL' | 'SQLite';

export interface ConnectionConfig {
  connectionString: string;
  dbType: DatabaseType;
}

export interface SavedConnection {
  id: string;
  name: string;
  connectionString: string;
  dbType: DatabaseType;
  createdAt: string;
}

export type ComparisonStatus = 'Identical' | 'Added' | 'Removed' | 'Modified';

export interface ColumnComparison {
  name: string;
  dataType: string;
  isNullable: boolean;
  status: ComparisonStatus;
}

export interface TableComparison {
  name: string;
  status: ComparisonStatus;
  sourceDefinition: string | null;
  targetDefinition: string | null;
  columns: ColumnComparison[];
}

export interface StoredProcComparison {
  name: string;
  status: ComparisonStatus;
  sourceDefinition: string | null;
  targetDefinition: string | null;
  diff: string | null;
}

export interface FunctionComparison {
  name: string;
  status: ComparisonStatus;
  sourceDefinition: string | null;
  targetDefinition: string | null;
  diff: string | null;
}

export interface ComparisonResult {
  tables: TableComparison[];
  storedProcs: StoredProcComparison[];
  functions: FunctionComparison[];
}
