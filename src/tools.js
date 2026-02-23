// Weather tool
// Web search tool
// Calendar tool
// Search memory, save memory tool
// List task, crete taks, edit task

const listTasks = tool(
  async ({ filter = "open" }) => {
    if (filter === "open") return taskStore.filter((t) => !t.done);
    if (filter === "done") return taskStore.filter((t) => t.done);
    return taskStore;
  },
  {
    name: "list_tasks",
    description: "List the user's tasks.",
    schema: z.object({
      filter: z.enum(["open", "done", "all"]).optional(),
    }),
  }
);


