export interface ResponseAction {
    type: 'message' | 'command'
    weight: number
    content: string
}

export function chooseResponse(
    actions: readonly ResponseAction[],
    random: () => number = Math.random
): ResponseAction | undefined {
    const enabled = actions.filter(
        (action) =>
            Number.isFinite(action.weight) &&
            action.weight > 0 &&
            action.content.trim().length > 0
    )
    if (enabled.length === 0) return

    // Scaling preserves relative weights without overflowing their sum.
    const maxWeight = enabled.reduce(
        (max, action) => Math.max(max, action.weight),
        0
    )
    const total = enabled.reduce(
        (sum, action) => sum + action.weight / maxWeight,
        0
    )
    let remaining = random() * total
    for (const action of enabled) {
        remaining -= action.weight / maxWeight
        if (remaining < 0) return action
    }
    return enabled[enabled.length - 1]
}

export class ResponseGate {
    private readonly entries = new Map<
        string,
        { until: number; running: boolean }
    >()

    acquire(key: string, cooldownMs: number, now = Date.now()): boolean {
        const previous = this.entries.get(key)
        if (previous && (previous.running || previous.until > now)) return false
        this.entries.set(key, { until: now + cooldownMs, running: true })
        return true
    }

    release(key: string) {
        const entry = this.entries.get(key)
        if (entry) entry.running = false
    }

    prune(now = Date.now()) {
        for (const [key, entry] of this.entries) {
            if (!entry.running && entry.until <= now) this.entries.delete(key)
        }
    }

    clear() {
        this.entries.clear()
    }
}
