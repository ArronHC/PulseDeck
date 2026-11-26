import { Flex, Text } from "@radix-ui/themes";

import { PulseLogoMark } from "./hub/PulseLogoMark";
import LanguageSwitch from "./Language";
import ThemeSwitch from "./ThemeSwitch";

export default function GuideHeader() {
  return (
    <Flex justify="between" align="center" gap="4" className="km-guide-header w-full">
      <Flex align="center" gap="2">
        <PulseLogoMark className="h-8 w-8 shrink-0" />
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
