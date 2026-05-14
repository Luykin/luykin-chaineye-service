import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { LegacyEjsPartial } from "@/components/legacy/LegacyEjsPartial";
import nacosMessagesHtml from "../../../src/xhunt/views/partials/nacos-messages.ejs?raw";

export function NacosMessagesPage() {
  return (
    <PermissionGuard permission="nacos-messages">
      <LegacyEjsPartial html={nacosMessagesHtml} tabId="nacos-messages" />
    </PermissionGuard>
  );
}
