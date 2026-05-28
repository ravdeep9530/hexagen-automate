import { Pool } from 'pg';
import type {
    NotificationChannel,
    NotificationSettings,
} from './notificationTypes';

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'agentic',
});

export async function initializeNotificationTable(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notification_settings (
            channel        TEXT        PRIMARY KEY,
            enabled        BOOLEAN     NOT NULL DEFAULT false,
            config         JSONB       NOT NULL DEFAULT '{}',
            triggers       TEXT[]      NOT NULL DEFAULT '{}',
            context_fields TEXT[]      NOT NULL DEFAULT '{}',
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

export async function getSettings(
    channel: NotificationChannel
): Promise<NotificationSettings | null> {
    const result = await pool.query(
        'SELECT * FROM notification_settings WHERE channel = $1',
        [channel]
    );
    if (result.rows.length === 0) return null;
    return rowToSettings(result.rows[0]);
}

export async function getAllSettings(): Promise<Record<NotificationChannel, NotificationSettings | null>> {
    const result = await pool.query('SELECT * FROM notification_settings');
    const map: Record<NotificationChannel, NotificationSettings | null> = { teams: null, email: null };
    for (const row of result.rows) {
        map[row.channel as NotificationChannel] = rowToSettings(row);
    }
    return map;
}

export async function upsertSettings(
    channel: NotificationChannel,
    patch: Partial<Omit<NotificationSettings, 'channel' | 'updated_at'>>
): Promise<NotificationSettings> {
    const current = await getSettings(channel);

    const enabled        = patch.enabled        ?? current?.enabled        ?? false;
    const config         = patch.config         ?? current?.config         ?? {};
    const triggers       = patch.triggers       ?? current?.triggers       ?? [];
    const context_fields = patch.context_fields ?? current?.context_fields ?? [];

    const result = await pool.query(
        `INSERT INTO notification_settings (channel, enabled, config, triggers, context_fields, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (channel) DO UPDATE SET
           enabled        = EXCLUDED.enabled,
           config         = EXCLUDED.config,
           triggers       = EXCLUDED.triggers,
           context_fields = EXCLUDED.context_fields,
           updated_at     = now()
         RETURNING *`,
        [channel, enabled, JSON.stringify(config), triggers, context_fields]
    );

    return rowToSettings(result.rows[0]);
}

function rowToSettings(row: Record<string, unknown>): NotificationSettings {
    return {
        channel:        row.channel        as NotificationChannel,
        enabled:        row.enabled        as boolean,
        config:         row.config         as NotificationSettings['config'],
        triggers:       row.triggers       as NotificationSettings['triggers'],
        context_fields: row.context_fields as NotificationSettings['context_fields'],
        updated_at:     String(row.updated_at),
    };
}
