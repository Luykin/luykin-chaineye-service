import { QRCode, Space, Typography } from "antd";

interface TotpSetupDetailsProps {
  setup: {
    secret: string;
    otpauthUri: string;
  };
}

export function TotpSetupDetails({ setup }: TotpSetupDetailsProps) {
  return (
    <Space wrap align="center" size={24} style={{ width: "100%", justifyContent: "center" }}>
      <div role="img" aria-label="Authenticator 绑定二维码">
        <QRCode
          type="svg"
          value={setup.otpauthUri}
          size={200}
          color="black"
          bgColor="white"
          errorLevel="M"
        />
      </div>
      <Space direction="vertical" size={12} style={{ maxWidth: 360 }}>
        <Typography.Text strong>使用 Authenticator 应用扫描二维码</Typography.Text>
        <Typography.Text type="secondary">
          可使用 Google Authenticator、Microsoft Authenticator、1Password 等兼容应用。二维码无法扫描时，可手动输入下方设置密钥，类型选择“基于时间”。
        </Typography.Text>
        <Typography.Text code copyable={{ text: setup.secret }} style={{ overflowWrap: "anywhere" }}>
          {setup.secret}
        </Typography.Text>
        <Typography.Link href={setup.otpauthUri}>在支持的 Authenticator 应用中直接打开</Typography.Link>
      </Space>
    </Space>
  );
}
