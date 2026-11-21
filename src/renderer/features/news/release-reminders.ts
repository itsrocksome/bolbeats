// BolBeats: "remind me" for announced releases. On release day (checked at launch and every hour) you get a Mac
// notification and an in-app message; then the reminder is cleared. Stored only on this Mac.
import { createWithEqualityFn } from 'zustand/traditional';

import { dueReminders, type FeedRelease, type Reminder } from '/@/renderer/features/news/feed';
import { toast } from '/@/shared/components/toast/toast';

const KEY = 'hookline_release_reminders';

const read = (): Record<string, Reminder> => {
    try {
        return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
    } catch {
        return {};
    }
};

export const useReminderStore = createWithEqualityFn<Record<string, Reminder>>(() => read());
export const useReminders = () => useReminderStore((s) => s);
export const loadReminders = () => useReminderStore.setState(read(), true);

const save = (next: Record<string, Reminder>) => {
    localStorage.setItem(KEY, JSON.stringify(next));
    useReminderStore.setState(next, true);
};

export const toggleReminder = (r: FeedRelease) => {
    const cur = { ...useReminderStore.getState() };
    if (cur[r.url]) delete cur[r.url];
    else
        cur[r.url] = {
            artist: r.artist,
            date: r.date,
            title: r.title.replace(/ - (single|ep)$/i, ''),
            url: r.url,
        };
    save(cur);
    if (cur[r.url]) toast.success({ message: `You’ll get a reminder on release day.` });
};

const check = () => {
    const all = useReminderStore.getState();
    const due = dueReminders(all, Date.now());
    if (!due.length) return;
    for (const r of due) {
        const text = `${r.artist}: ${r.title} is out today.`;
        try {
            new Notification('Out now', { body: text });
        } catch {
            // notifications off: the in-app message below still shows
        }
        toast.info({ message: text, title: 'New release' });
    }
    save(
        Object.fromEntries(Object.entries(all).filter(([url]) => !due.some((d) => d.url === url))),
    );
};

setTimeout(check, 5000);
setInterval(check, 60 * 60 * 1000);
