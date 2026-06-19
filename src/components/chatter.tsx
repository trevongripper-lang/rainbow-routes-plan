import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Reply, Trash2 } from "lucide-react";

type Profile = { id: string; display_name: string | null; avatar_url: string | null };
type Comment = {
  id: string;
  destination_id: string;
  user_id: string;
  body: string;
  parent_id: string | null;
  mentions: string[] | null;
  created_at: string;
};

export function Chatter({ destinationId, me }: { destinationId: string; me: string }) {
  const qc = useQueryClient();

  const { data: members = [] } = useQuery({
    queryKey: ["trip-members-profiles", destinationId],
    queryFn: async (): Promise<Profile[]> => {
      const { data: rows } = await supabase
        .from("trip_members").select("user_id").eq("destination_id", destinationId);
      const ids = (rows ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data: profs } = await supabase.rpc("get_public_profiles", { _ids: ids });
      return (profs as Profile[]) ?? [];
    },
  });
  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const { data: comments = [] } = useQuery({
    queryKey: ["chatter", destinationId],
    queryFn: async (): Promise<Comment[]> => {
      const { data, error } = await supabase
        .from("comments")
        .select("id, destination_id, user_id, body, parent_id, mentions, created_at")
        .eq("destination_id", destinationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Comment[]) ?? [];
    },
  });

  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesByParent = useMemo(() => {
    const m = new Map<string, Comment[]>();
    for (const c of comments) {
      if (c.parent_id) {
        const arr = m.get(c.parent_id) ?? [];
        arr.push(c);
        m.set(c.parent_id, arr);
      }
    }
    return m;
  }, [comments]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chatter", destinationId] }),
  });

  return (
    <section>
      <div className="flex items-center gap-2">
        <MessageSquare className="size-5 text-primary" />
        <h2 className="font-display text-2xl">Chatter</h2>
      </div>
      <p className="text-sm text-muted-foreground">Trip tips, flight finds, club intel. <span className="text-foreground/80">Type @ to mention.</span></p>

      <Composer
        destinationId={destinationId}
        me={me}
        members={members}
        parentId={null}
        autoFocus={false}
      />

      <ul className="mt-6 space-y-4">
        {topLevel.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No chatter yet. Kick it off.
          </li>
        )}
        {topLevel.map((c) => {
          const replies = repliesByParent.get(c.id) ?? [];
          return (
            <li key={c.id} className="rounded-xl border border-border/60 bg-card p-4">
              <CommentRow comment={c} memberMap={memberMap} me={me} onDelete={() => del.mutate(c.id)} />
              {replies.length > 0 && (
                <ul className="mt-3 space-y-3 border-l-2 border-primary/30 pl-4">
                  {replies.map((r) => (
                    <li key={r.id} className="rounded-lg bg-background/40 p-3">
                      <CommentRow comment={r} memberMap={memberMap} me={me} onDelete={() => del.mutate(r.id)} />
                    </li>
                  ))}
                </ul>
              )}
              <ReplyToggle destinationId={destinationId} me={me} members={members} parentId={c.id} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CommentRow({
  comment, memberMap, me, onDelete,
}: { comment: Comment; memberMap: Map<string, Profile>; me: string; onDelete: () => void }) {
  const author = memberMap.get(comment.user_id);
  const isMine = comment.user_id === me;
  const youMentioned = (comment.mentions ?? []).includes(me);
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="grid size-6 place-items-center rounded-full bg-primary/20 text-[10px] font-medium text-primary">
          {(author?.display_name ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <span className="text-foreground">{author?.display_name ?? "Someone"}</span>
        <span>· {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}</span>
        {youMentioned && (
          <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">@you</span>
        )}
        {isMine && (
          <button onClick={onDelete} className="ml-auto text-muted-foreground hover:text-destructive" aria-label="Delete">
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{renderBody(comment.body, memberMap)}</p>
    </div>
  );
}

function renderBody(body: string, memberMap: Map<string, Profile>) {
  // Highlight @Name tokens that resolve to a known member
  const names = new Set(
    Array.from(memberMap.values()).map((m) => (m.display_name ?? "").toLowerCase()).filter(Boolean),
  );
  const parts = body.split(/(@[\w][\w \-]*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("@")) {
      const candidate = p.slice(1).trim().toLowerCase();
      // longest-match check
      const hit = Array.from(names).find((n) => candidate.startsWith(n));
      if (hit) {
        return (
          <span key={i}>
            <span className="rounded bg-primary/15 px-1 text-primary">@{p.slice(1, 1 + hit.length)}</span>
            {p.slice(1 + hit.length)}
          </span>
        );
      }
    }
    return <span key={i}>{p}</span>;
  });
}

function ReplyToggle(props: { destinationId: string; me: string; members: Profile[]; parentId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
      >
        <Reply className="size-3.5" /> Reply
      </button>
    );
  }
  return (
    <div className="mt-3">
      <Composer
        destinationId={props.destinationId}
        me={props.me}
        members={props.members}
        parentId={props.parentId}
        autoFocus
        onDone={() => setOpen(false)}
      />
    </div>
  );
}

function Composer({
  destinationId, me, members, parentId, autoFocus, onDone,
}: {
  destinationId: string;
  me: string;
  members: Profile[];
  parentId: string | null;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    const q = pickerQuery.toLowerCase();
    return members
      .filter((m) => m.id !== me && (m.display_name ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [members, pickerQuery, me]);

  const onChangeBody = (val: string) => {
    setBody(val);
    // Detect a trailing @token at the caret
    const caret = textareaRef.current?.selectionStart ?? val.length;
    const upToCaret = val.slice(0, caret);
    const m = upToCaret.match(/(?:^|\s)@([\w \-]{0,30})$/);
    if (m) {
      setPickerQuery(m[1]);
      setShowPicker(true);
    } else {
      setShowPicker(false);
    }
  };

  const insertMention = (p: Profile) => {
    const caret = textareaRef.current?.selectionStart ?? body.length;
    const before = body.slice(0, caret);
    const after = body.slice(caret);
    const replaced = before.replace(/(^|\s)@([\w \-]{0,30})$/, (_m, pre) => `${pre}@${p.display_name ?? "user"} `);
    const newBody = replaced + after;
    setBody(newBody);
    setShowPicker(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!body.trim()) return;
      // Parse mentions by matching @<displayName> tokens against members
      const mentioned: string[] = [];
      for (const m of members) {
        const name = m.display_name?.trim();
        if (!name) continue;
        const re = new RegExp(`(^|\\s)@${escapeRegex(name)}(?=\\s|[.,!?]|$)`, "i");
        if (re.test(body) && !mentioned.includes(m.id)) mentioned.push(m.id);
      }
      const { error } = await supabase.from("comments").insert({
        destination_id: destinationId,
        user_id: me,
        body: body.trim(),
        parent_id: parentId,
        mentions: mentioned,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["chatter", destinationId] });
      onDone?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}
      className="relative mt-4 space-y-2"
    >
      <Textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={body}
        onChange={(e) => onChangeBody(e.target.value)}
        placeholder={parentId ? "Write a reply… (@ to mention)" : "Add to the chatter… (@ to mention)"}
        rows={parentId ? 2 : 3}
      />
      {showPicker && matches.length > 0 && (
        <div className="absolute bottom-12 left-2 z-10 w-56 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-xl">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Mention</div>
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => insertMention(m)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-card"
            >
              <div className="grid size-5 place-items-center rounded-full bg-primary/20 text-[10px] font-medium text-primary">
                {(m.display_name ?? "?").slice(0, 1).toUpperCase()}
              </div>
              {m.display_name ?? "Member"}
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {onDone && <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>}
        <Button type="submit" size={parentId ? "sm" : "default"} disabled={submit.isPending || !body.trim()}>
          {parentId ? "Reply" : "Post"}
        </Button>
      </div>
    </form>
  );
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
