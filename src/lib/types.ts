export type Medication = {
  id: number;
  name: string;
  /** Hàm lượng, ví dụ "500mg" */
  dosage: string;
  /** Đơn vị mỗi lần uống: viên, ml, gói... */
  unit: string;
  /** Số lượng mỗi lần uống (theo đơn vị) */
  doseAmount: number;
  /** Cách uống: "Sau ăn", "Trước ăn"... */
  instructions: string;
  notes: string;
  color: string;
  photoUri: string | null;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, null = dùng lâu dài */
  endDate: string | null;
  /** Thứ trong tuần theo Date.getDay() (0 = CN). Rỗng = hằng ngày */
  days: number[];
  /** Số lượng còn lại; null = không theo dõi */
  stock: number | null;
  active: boolean;
  archived: boolean;
  createdAt: string;
  /** Các giờ uống "HH:mm", đã sắp xếp */
  times: string[];
};

export type MedicationInput = Omit<Medication, 'id' | 'createdAt' | 'archived'>;

export type DoseLogStatus = 'taken' | 'skipped';

export type DoseLog = {
  id: number;
  medicationId: number;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  status: DoseLogStatus;
  actedAt: string;
};

export type DoseStatus = DoseLogStatus | 'upcoming' | 'due' | 'missed';

export type DoseItem = {
  medication: Medication;
  date: string;
  time: string;
  status: DoseStatus;
  log: DoseLog | null;
};

export type Settings = {
  snoozeMinutes: number;
  missedAfterMinutes: number;
  lowStockDays: number;
  fontScale: number;
  reliabilitySetupDone: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  snoozeMinutes: 10,
  missedAfterMinutes: 60,
  lowStockDays: 5,
  fontScale: 1.15,
  reliabilitySetupDone: false,
};
