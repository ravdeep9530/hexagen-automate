export type NotificationChannel = 'teams' | 'email';

export type NotificationTrigger =
  | 'stage_approval'
  | 'pipeline_complete'
  | 'pipeline_rejected';

export type NotificationContextField =
  | 'artifact_summary'
  | 'stage_details'
  | 'run_id'
  | 'pr_link';

export interface TeamsChannelConfig {
    webhook_url: string;
}

export interface EmailChannelConfig {
    smtp_host: string;
    smtp_port: number;
    smtp_secure: boolean;
    smtp_user: string;
    smtp_pass: string;
    recipients: string[];
}

export interface NotificationSettings {
    channel: NotificationChannel;
    enabled: boolean;
    config: TeamsChannelConfig | EmailChannelConfig;
    triggers: NotificationTrigger[];
    context_fields: NotificationContextField[];
    updated_at: string;
}
