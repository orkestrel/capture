// The reader refuses this module's reader: it returns a string where a list of findings belongs.

/** Lists one reader that returns a string instead of a list of findings. */
export const CAPTURE_CHECKS = [(): string => 'not a list']
