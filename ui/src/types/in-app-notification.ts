export type InAppNotificationSeverity =
  | "info"
  | "success"
  | "warning"
  | "error";

export interface InAppNotificationDocument {
  _id: string;
  event_key: string;
  recipient_user_subjects: string[];
  recipient_team_slugs: string[];
  recipient_organization_admins: boolean;
  title: string;
  message: string;
  href?: string;
  severity: InAppNotificationSeverity;
  created_at: string;
  updated_at: string;
  read_by_subjects: string[];
  archived_at?: string;
}

export interface InAppNotificationView {
  id: string;
  title: string;
  message: string;
  href?: string;
  severity: InAppNotificationSeverity;
  created_at: string;
  read: boolean;
}

export interface InAppNotificationPage {
  notifications: InAppNotificationView[];
  unread_count: number;
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}
