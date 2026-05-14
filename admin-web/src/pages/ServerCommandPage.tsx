import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Input,
  Row,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useMutation } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { PageSection } from "@/components/ui/PageSection";
import { executeServerCommand } from "@/services/admin-tools";

interface TerminalEntry {
  id: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  cwd?: string;
  exitCode?: number;
  executionTime?: number;
  type: "welcome" | "command" | "result" | "error";
}

const QUICK_COMMAND_GROUPS = [
  {
    title: "PM2 管理",
    items: ["pm2 list", "pm2 restart all", "pm2 stop all", "pm2 status"],
  },
  {
    title: "文件操作",
    items: ["pwd", "ls -la", "df -h", "du -sh *"],
  },
  {
    title: "日志查看",
    items: ["tail -n 50 logs/app-out.log", "tail -n 50 logs/app-err.log"],
  },
  {
    title: "Git / NPM",
    items: ["git status", "git pull", "npm run restart-api", "npm run restart"],
  },
];

function createWelcomeEntries(): TerminalEntry[] {
  return [
    {
      id: "welcome-1",
      type: "welcome",
      stdout: "欢迎使用服务器命令终端",
    },
    {
      id: "welcome-2",
      type: "welcome",
      stdout: "输入命令并按 Enter 执行，支持命令历史（上下箭头键）",
    },
  ];
}

export function ServerCommandPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [entries, setEntries] = useState<TerminalEntry[]>(createWelcomeEntries);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const mutation = useMutation({
    mutationFn: executeServerCommand,
    onSuccess: (result, submittedCommand) => {
      setEntries((current) => [
        ...current,
        {
          id: `${Date.now()}-cmd`,
          type: "command",
          command: submittedCommand,
        },
        {
          id: `${Date.now()}-res`,
          type: result.exitCode && result.exitCode !== 0 ? "error" : "result",
          stdout: result.stdout,
          stderr: result.stderr,
          cwd: result.cwd,
          exitCode: result.exitCode,
          executionTime: result.executionTime,
        },
      ]);
      setTimeout(() => {
        outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
      }, 30);
    },
    onError: (error: Error, submittedCommand) => {
      setEntries((current) => [
        ...current,
        {
          id: `${Date.now()}-cmd`,
          type: "command",
          command: submittedCommand,
        },
        {
          id: `${Date.now()}-err`,
          type: "error",
          stderr: error.message || "命令执行失败",
        },
      ]);
      messageApi.error(error.message || "命令执行失败");
    },
  });

  const runCommand = (value: string) => {
    const nextCommand = value.trim();
    if (!nextCommand) {
      messageApi.warning("请输入命令");
      return;
    }
    setHistory((current) => [nextCommand, ...current.filter((item) => item !== nextCommand)].slice(0, 50));
    setHistoryIndex(-1);
    setCommand("");
    mutation.mutate(nextCommand);
  };

  const terminalContent = useMemo(
    () =>
      entries.map((entry) => {
        if (entry.type === "command") {
          return (
            <div key={entry.id} style={{ marginBottom: 8 }}>
              <Typography.Text style={{ color: "#4ec9b0" }}>$</Typography.Text>
              <Typography.Text style={{ color: "#e2e8f0", marginLeft: 8, whiteSpace: "pre-wrap" }}>
                {entry.command}
              </Typography.Text>
            </div>
          );
        }

        const output = [entry.stdout, entry.stderr].filter(Boolean).join("\n");
        return (
          <div key={entry.id} style={{ marginBottom: 12 }}>
            {output ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: entry.type === "error" ? "#fca5a5" : "#d4d4d4",
                  fontFamily: "inherit",
                }}
              >
                {output}
              </pre>
            ) : null}
            {entry.type !== "welcome" && (entry.cwd || entry.executionTime !== undefined) ? (
              <Space size={8} wrap style={{ marginTop: 6 }}>
                {entry.cwd ? <Tag color="blue">{entry.cwd}</Tag> : null}
                {entry.exitCode !== undefined ? (
                  <Tag color={entry.exitCode === 0 ? "success" : "error"}>
                    exit {entry.exitCode}
                  </Tag>
                ) : null}
                {entry.executionTime !== undefined ? (
                  <Tag>{entry.executionTime} ms</Tag>
                ) : null}
              </Space>
            ) : null}
          </div>
        );
      }),
    [entries]
  );

  return (
    <PermissionGuard permission="server:execute">
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <PageSection
          title="服务器命令"
          description="执行服务器命令、查看输出结果，并使用常见命令快捷入口。"
          extra={
            <Space>
              <Button onClick={() => setEntries(createWelcomeEntries())}>清屏</Button>
              <Button onClick={() => runCommand("pwd")} loading={mutation.isPending}>
                显示路径
              </Button>
            </Space>
          }
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="高风险功能"
            description="该功能仅适用于受控运维场景。后端仍会做权限与危险命令拦截。"
          />

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={17}>
              <Card
                styles={{
                  body: {
                    padding: 16,
                    background: "#1e1e1e",
                    borderRadius: 12,
                  },
                }}
              >
                <div
                  ref={outputRef}
                  style={{
                    background: "#0d0d0d",
                    border: "1px solid #3e3e3e",
                    borderRadius: 8,
                    padding: 16,
                    height: 460,
                    overflowY: "auto",
                    fontFamily: "Consolas, Monaco, Courier New, monospace",
                  }}
                >
                  {terminalContent}
                </div>

                <Space.Compact style={{ width: "100%", marginTop: 16 }}>
                  <Input
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder="输入命令..."
                    onPressEnter={() => runCommand(command)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp" && history.length) {
                        event.preventDefault();
                        const nextIndex = Math.min(historyIndex + 1, history.length - 1);
                        setHistoryIndex(nextIndex);
                        setCommand(history[nextIndex]);
                      }
                      if (event.key === "ArrowDown" && history.length) {
                        event.preventDefault();
                        const nextIndex = historyIndex - 1;
                        if (nextIndex < 0) {
                          setHistoryIndex(-1);
                          setCommand("");
                        } else {
                          setHistoryIndex(nextIndex);
                          setCommand(history[nextIndex]);
                        }
                      }
                    }}
                    styles={{
                      input: {
                        background: "#252526",
                        color: "#e2e8f0",
                        borderColor: "#3e3e3e",
                        fontFamily: "Consolas, Monaco, Courier New, monospace",
                      },
                    }}
                  />
                  <Button type="primary" onClick={() => runCommand(command)} loading={mutation.isPending}>
                    执行
                  </Button>
                </Space.Compact>
              </Card>
            </Col>

            <Col xs={24} xl={7}>
              <Collapse
                defaultActiveKey={["quick"]}
                items={[
                  {
                    key: "quick",
                    label: "常用命令",
                    children: (
                      <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        {QUICK_COMMAND_GROUPS.map((group) => (
                          <div key={group.title}>
                            <Typography.Text strong>{group.title}</Typography.Text>
                            <Space wrap style={{ display: "flex", marginTop: 8 }}>
                              {group.items.map((item) => (
                                <Button
                                  key={item}
                                  size="small"
                                  onClick={() => setCommand(item)}
                                >
                                  {item}
                                </Button>
                              ))}
                            </Space>
                          </div>
                        ))}
                      </Space>
                    ),
                  },
                ]}
              />
            </Col>
          </Row>
        </PageSection>
      </Space>
    </PermissionGuard>
  );
}
