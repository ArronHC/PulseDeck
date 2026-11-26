import { Flex, Text } from "@radix-ui/themes";

import LanguageSwitch from "./Language";
import ThemeSwitch from "./ThemeSwitch";

export default function GuideHeader() {
  return (
    <Flex justify="between" align="center" gap="4" className="km-guide-header w-full">
      <Flex align="center" gap="2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 14h4l2-7 4 14 2-7h4" />
          </svg>
        </span>
        <Text size="3" weight="bold">
          PulseDeck
        </Text>
      </Flex>
      <Flex gap="2">
        <LanguageSwitch />
        <ThemeSwitch />
      </Flex>
    </Flex>
  );
}
