import rateLimit from "express-rate-limit";

export const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  limit: 5,                    // 5 bookings per IP per hour
  standardHeaders: "draft-7",
  message: { error: "Too many booking attempts. Please try again later." },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
});
