import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import HostConversationActions from "../HostConversationActions";

const mockLoad = jest.fn();
const mockArchive = jest.fn();
jest.mock("../host-chat", () => ({ loadHostConversation: (...args: unknown[]) => mockLoad(...args) }));
jest.mock("@/store/chat-store", () => ({ useChatStore: { getState: () => ({ deleteConversation: mockArchive }) } }));
jest.mock("@/components/chat/ShareButton", () => ({ ShareButton: ({ conversationId }: { conversationId: string }) =>
  <button>Share {conversationId}</button> }));
jest.mock("@/components/chat/RecycleBinDialog", () => ({ RecycleBinDialog: ({ open, onRestored }: { open: boolean; onRestored?: () => void }) =>
  open ? <div role="dialog" aria-label="Shared archive"><button onClick={onRestored}>Restore</button></div> : null }));

const props = { appId: "example-app", agentId: "example-agent", conversationId: "example-chat",
  onArchived: jest.fn(), onHistoryChange: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ saved: { _id: "example-chat", title: "Example", access_level: "owner" } });
  mockArchive.mockResolvedValue(undefined);
});

it("uses the host share control and the shared archive overlay", async () => {
  render(<HostConversationActions {...props} />);
  await screen.findByRole("button", { name: "Share example-chat" });
  expect(mockLoad).toHaveBeenCalledWith("example-app", "example-agent", "example-chat");
  fireEvent.click(screen.getByRole("button", { name: "Open archive" }));
  expect(screen.getByRole("dialog", { name: "Shared archive" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(props.onHistoryChange).toHaveBeenCalledTimes(1);
});

it("archives through the host store and only then notifies the app", async () => {
  render(<HostConversationActions {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Archive conversation" }));
  await waitFor(() => expect(props.onArchived).toHaveBeenCalledTimes(1));
  expect(mockArchive).toHaveBeenCalledWith("example-chat", { selectNext: false });
});

it("keeps the selected chat when the archive request fails", async () => {
  mockArchive.mockRejectedValue(new Error("Archive was denied"));
  render(<HostConversationActions {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Archive conversation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Archive was denied");
  expect(props.onArchived).not.toHaveBeenCalled();
});

it("does not show owner controls for a shared conversation", async () => {
  mockLoad.mockResolvedValue({ saved: { access_level: "shared" } });
  render(<HostConversationActions {...props} />);
  await screen.findByRole("button", { name: "Open archive" });
  expect(screen.queryByRole("button", { name: /Share|Archive conversation/ })).toBeNull();
});

it("fails closed when app or conversation access is denied", async () => {
  mockLoad.mockRejectedValue(new Error("Access denied"));
  render(<HostConversationActions {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(screen.queryByRole("button")).toBeNull();
  expect(mockArchive).not.toHaveBeenCalled();
});

it("blocks archive while the app is changing conversations", async () => {
  render(<HostConversationActions {...props} disabled />);
  expect(await screen.findByRole("button", { name: "Archive conversation" })).toBeDisabled();
  expect(mockArchive).not.toHaveBeenCalled();
});
