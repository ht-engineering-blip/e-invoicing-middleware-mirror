/**
 * Time constants and durations in milliseconds
 */
export enum TimeDuration {
  SECOND = 1000,
  MINUTE = 60 * 1000,
  FIVE_MINUTES = 5 * 60 * 1000,
  TEN_MINUTES = 10 * 60 * 1000,
  HOUR = 60 * 60 * 1000,
  TWELVE_HOURS = 12 * 60 * 60 * 1000,
  DAY = 24 * 60 * 60 * 1000,
  WEEK = 7 * 24 * 60 * 60 * 1000,
  THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000,
  YEAR = 365 * 24 * 60 * 60 * 1000,
}

export const TIME_MS = {
  ONE_SECOND: TimeDuration.SECOND,
  ONE_MINUTE: TimeDuration.MINUTE,
  FIVE_MINUTES: TimeDuration.FIVE_MINUTES,
  TEN_MINUTES: TimeDuration.TEN_MINUTES,
  ONE_HOUR: TimeDuration.HOUR,
  TWELVE_HOURS: TimeDuration.TWELVE_HOURS,
  ONE_DAY: TimeDuration.DAY,
  ONE_WEEK: TimeDuration.WEEK,
  THIRTY_DAYS: TimeDuration.THIRTY_DAYS,
  ONE_YEAR: TimeDuration.YEAR,
} as const;
