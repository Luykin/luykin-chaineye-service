import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { LegacyEjsPartial } from "@/components/legacy/LegacyEjsPartial";
import nacosMessagesHtml from "@/legacy/ejs/nacos-messages.ejs?raw";
import { registerLegacyNacosMessages } from "@/legacy/nacosMessagesLegacy";

export function NacosMessagesPage() {
  return (
    <PermissionGuard permission="nacos-messages">
      <LegacyEjsPartial html={nacosMessagesHtml} tabId="nacos-messages" initialize={registerLegacyNacosMessages} />
    </PermissionGuard>
  );
}
