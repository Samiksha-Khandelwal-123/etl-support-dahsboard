import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Copy,
  Download,
  Loader2,
  ScrollText,
  AlertCircle,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

interface LogEvent {
  timestamp: string;
  message: string;
  stream: string;
}

interface CloudWatchLogsResponse {
  jobId?: string;
  functionName?: string;
  logGroup: string;
  events: LogEvent[];
  eventCount: number;
  timestamp: string;
  error?: string;
}

interface Props {
  jobId: string | null;
  jobName: string | null;
  resourceType: "job" | "lambda";
  open: boolean;
  onClose: () => void;
}

export default function CloudWatchLogViewer({
  jobId,
  jobName,
  resourceType,
  open,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);

  const { data: logsData, isLoading, error } = useQuery<CloudWatchLogsResponse>({
    queryKey: ["cloudwatch-logs", resourceType, jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const endpoint =
        resourceType === "lambda"
          ? `/api/logs/lambda/${jobName}`
          : `/api/logs/job/${jobId}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("Failed to load logs");
      return res.json();
    },
    enabled: open && !!jobId,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const logs = logsData?.events || [];
  const logGroup = logsData?.logGroup || "";

  const handleCopyLogs = () => {
    const logText = logs.map((e) => `[${e.timestamp}] ${e.message}`).join("\n");
    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadLogs = () => {
    const logText = logs.map((e) => `[${e.timestamp}] ${e.message}`).join("\n");
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(logText));
    element.setAttribute("download", `${jobId}-logs.txt`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            CloudWatch Logs {resourceType === "lambda" ? "- Lambda" : "- Glue Job"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-2">
            {jobName || jobId}
          </p>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 gap-3">
          {/* Log Group Info */}
          <div className="px-1 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              <span className="font-mono bg-slate-100 px-2 py-1 rounded">
                {logGroup}
              </span>
              <span className="ml-3">
                {logsData?.eventCount || 0} events
              </span>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyLogs}
                disabled={logs.length === 0}
                className="h-8 text-xs"
              >
                <Copy className="h-3 w-3 mr-1" />
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadLogs}
                disabled={logs.length === 0}
                className="h-8 text-xs"
              >
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
            </div>
          </div>

          {/* Logs Display */}
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <p className="text-sm font-medium">Failed to load logs</p>
              <p className="text-xs text-muted-foreground">{error.message}</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <AlertCircle className="h-8 w-8 text-amber-500" />
              <p className="text-sm font-medium">No logs available</p>
              <p className="text-xs text-muted-foreground">
                This {resourceType === "lambda" ? "function" : "job"} may not have any log output yet.
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1 border rounded-lg bg-slate-950 text-slate-100 font-mono text-xs p-3">
              <div className="space-y-1 pr-4">
                {logs.map((log, idx) => (
                  <div key={idx} className="text-slate-300 hover:bg-slate-900 px-2 rounded transition-colors">
                    <span className="text-slate-500">[{log.timestamp}]</span>
                    <span className="ml-2">{log.message}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="text-xs text-muted-foreground border-t pt-2">
          Last updated: {new Date(logsData?.timestamp || Date.now()).toLocaleString()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
