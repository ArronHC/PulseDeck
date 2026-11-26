import { useId } from "react";

interface PulseLogoMarkProps {
  className?: string;
}

/**
 * Official PulseDeck layered-card + pulse vector mark from the brand kit.
 */
export function PulseLogoMark({ className = "h-7 w-7" }: PulseLogoMarkProps) {
  const uid = useId().replace(/:/g, "");
  const backId = `pd-back-${uid}`;
  const midId = `pd-mid-${uid}`;
  const frontId = `pd-front-${uid}`;
  return (
    <svg
      viewBox="57 250 354 354"
      className={className}
      role="img"
      aria-label="PulseDeck"
    >
      <defs>
        <linearGradient id={backId} x1="0" y1="1" x2="0.7" y2="0">
          <stop stopColor="#75D7D7" />
          <stop offset="1" stopColor="#A0EEE9" />
        </linearGradient>
        <linearGradient id={midId} x1="0" y1="1" x2="0.8" y2="0">
          <stop stopColor="#00A59D" />
          <stop offset="1" stopColor="#00CEC4" />
        </linearGradient>
        <linearGradient id={frontId} x1="0.1" y1="0.9" x2="0.8" y2="0">
          <stop stopColor="#084BAE" />
          <stop offset="0.5" stopColor="#0765D9" />
          <stop offset="1" stopColor="#1189FA" />
        </linearGradient>
      </defs>
      <path
        d="M87 377 C87 363 94 353 108 347 L241 290 C256 283 269 291 269 307 L269 426 C269 441 260 450 245 457 L110 503 C96 508 87 500 87 486 Z"
        fill={`url(#${backId})`}
      />
      <path
        d="M122 396 C122 381 131 371 145 365 L290 308 C305 302 319 311 319 327 L319 455 C319 470 309 481 293 486 L146 534 C132 539 122 529 122 515 Z"
        fill={`url(#${midId})`}
      />
      <path
        d="M162 418 C162 400 172 389 189 383 L348 335 C365 330 381 341 381 358 L381 485 C381 501 372 513 356 518 L190 564 C174 569 162 557 162 540 Z"
        fill={`url(#${frontId})`}
      />
      <path
        d="M163.5 541 V418 C163.5 401 174 390 189 385 L348 337 C360 333 373 339 378 351"
        fill="none"
        stroke="#77C4FF"
        strokeWidth="2.8"
        strokeLinecap="round"
        opacity=".75"
      />
      <path
        d="M169 468 L247 462 L273 397 L298 500 L319 452 L372 448"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="14.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
