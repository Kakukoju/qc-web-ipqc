/** Centralized Framer Motion animation constants for Skyla Mobile Scan UI */
export const MOTION = {
  duration: {
    fast: 0.2,
    normal: 0.3,
    emphasis: 0.4,
  },
  easing: {
    enter: [0.0, 0.0, 0.2, 1] as const,
    exit: [0.4, 0.0, 1, 1] as const,
    standard: [0.4, 0.0, 0.2, 1] as const,
  },
  spring: {
    gentle: { type: 'spring' as const, stiffness: 200, damping: 20 },
  },
} as const;

export const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION.duration.normal } },
  exit: { opacity: 0, y: -10, transition: { duration: MOTION.duration.fast } },
};

export const slideInVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION.duration.normal, delay: 0.1 } },
};
