export const SIGNAL_TERM = 15;
export const SIGNAL_KILL = 9;

export type ProcessSignal = typeof SIGNAL_TERM | typeof SIGNAL_KILL;
