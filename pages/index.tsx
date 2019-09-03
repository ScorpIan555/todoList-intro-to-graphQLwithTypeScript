import * as React from "react";
import produce from "immer";
import nanoid from "nanoid";
// graphql imports
import { API, graphqlOperation } from "aws-amplify";
import config from "../src/aws-exports";
import { createTodo, createTodoList } from "../src/graphql/mutations";
import {
  onCreateTodo,
  onUpdateTodo,
  onDeleteTodo
} from "../src/graphql/subscriptions";
import {
  GetTodoListQuery,
  OnCreateTodoSubscription,
  OnUpdateTodoSubscription,
  OnDeleteTodoSubscription
} from "../src/API";
import { getTodoList } from "../src/graphql/queries";

API.configure(config);
// Should be a device id or a cognito user id but this will do
const MY_ID = nanoid();

type Props = {
  todos: GetTodoListQuery["getTodoList"]["todos"]["items"];
};

type Todo = {
  id: string;
  name: string;
  createdAt: string;
  completed: boolean;
};
type State = { todos: Todo[]; currentTodo: string };

type Action =
  | { type: "add" | "update" | "delete"; payload: Todo }
  | { type: "set-current"; payload: string };

/*
With TS we create an Observable type to describe the return type of a GraphQL subscription.
Hopefully in future releases of aws-amplify we will have generic types for API.graphql that will make this un-necessary.
*/
type Observable<Value = unknown, Error = {}> = {
  subscribe: (
    cb?: (v: Value) => void,
    errorCb?: (e: Error) => void,
    completeCallback?: () => void
  ) => { unsubscribe: Function };
};

type Listener<T> = Observable<{ value: { data: T } }>;

const reducer: React.Reducer<State, Action> = (state, action) => {
  switch (action.type) {
    case "set-current": {
      return produce(state, draft => {
        draft.currentTodo = action.payload;
      });
    }
    case "add": {
      return produce(state, draft => {
        draft.todos.push(action.payload);
      });
    }
    case "update": {
      const todoIndex = state.todos.findIndex(
        todo => todo.id === action.payload.id
      );
      if (todoIndex === -1) return state;
      return produce(state, draft => {
        draft.todos[todoIndex] = { ...action.payload };
      });
    }
    case "delete": {
      const todoIndex = state.todos.findIndex(
        todo => todo.id === action.payload.id
      );
      if (todoIndex === -1) return state;
      return produce(state, draft => {
        draft.todos.splice(todoIndex, 1);
      });
    }

    default: {
      throw new Error(`Unsupported action ${JSON.stringify(action)}`);
    }
  }
};

const App = ({ todos }: Props) => {
  console.log("App.this:::", this);
  // declare state with Reducer Hooks
  const [state, dispatch] = React.useReducer(reducer, {
    currentTodo: "",
    todos
  });
  console.log("App.state:::", state);
  console.log("App.dispatch:::", dispatch);
  console.log("App.dispatch:::", state.currentTodo);
  // after each render useEffect() call is made
  //
  React.useEffect(() => {
    const onCreateListener: Listener<OnCreateTodoSubscription> = API.graphql(
      graphqlOperation(onCreateTodo)
    );
    const onUpdateListener: Listener<OnUpdateTodoSubscription> = API.graphql(
      graphqlOperation(onUpdateTodo)
    );
    const onDeleteListener: Listener<OnDeleteTodoSubscription> = API.graphql(
      graphqlOperation(onDeleteTodo)
    );

    const onCreateSubscription = onCreateListener.subscribe(v => {
      if (v.value.data.onCreateTodo.userId === MY_ID) return;
      dispatch({ type: "add", payload: v.value.data.onCreateTodo });
    });
    const onUpdateSubscription = onUpdateListener.subscribe(v => {
      dispatch({ type: "update", payload: v.value.data.onUpdateTodo });
    });
    const onDeleteSubscription = onDeleteListener.subscribe(v => {
      dispatch({ type: "delete", payload: v.value.data.onDeleteTodo });
    });

    return () => {
      onCreateSubscription.unsubscribe();
      onUpdateSubscription.unsubscribe();
      onDeleteSubscription.unsubscribe();
    };
  }, []);
  // state manipulation definitions
  //
  const add = async () => {
    const todo = {
      id: nanoid(),
      name: state.currentTodo,
      completed: false,
      createdAt: `${Date.now()}`
    };
    dispatch({
      type: "add",
      payload: todo
    });
    // Optimistic update
    dispatch({ type: "set-current", payload: "" });
    try {
      await API.graphql(
        graphqlOperation(createTodo, {
          input: { ...todo, todoTodoListId: "global", userId: MY_ID }
        })
      );
    } catch (err) {
      // With revert on error
      dispatch({ type: "set-current", payload: todo.name });
    }
  };

  const edit = (todo: Todo) => {
    dispatch({ type: "update", payload: todo });
  };
  const del = (todo: Todo) => {
    dispatch({ type: "delete", payload: todo });
  };

  return (
    <>
      <header>
        <h2>To Do List</h2>
      </header>
      <main>
        <form
          onSubmit={event => {
            event.preventDefault();
            add();
          }}
        >
          <input
            type="text"
            value={state.currentTodo}
            onChange={event => {
              dispatch({ type: "set-current", payload: event.target.value });
            }}
          />
          <button type="submit">Add</button>
        </form>
        <ul>
          {state.todos.map(todo => {
            return (
              <li key={todo.id}>
                <input
                  type={"text"}
                  value={todo.name}
                  onChange={event => {
                    edit({ ...todo, name: event.target.value });
                  }}
                />
                <button
                  onClick={() => {
                    del(todo);
                  }}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
};

App.getInitialProps = async () => {
  let result: { data: GetTodoListQuery; errors: {}[] };
  try {
    // Fetch our list from the server
    result = await API.graphql(graphqlOperation(getTodoList, { id: "global" }));
  } catch (err) {
    console.warn(err);
    return { todos: [] };
  }
  if (result.errors) {
    console.warn("Failed to fetch todolist. ", result.errors);
    return { todos: [] };
  }
  if (result.data.getTodoList !== null) {
    return { todos: result.data.getTodoList.todos.items };
  }

  try {
    // And if it doesn't exist, create it
    await API.graphql(
      graphqlOperation(createTodoList, {
        input: {
          id: "global",
          createdAt: `${Date.now()}`
        }
      })
    );
  } catch (err) {
    console.warn(err);
  }
  return { todos: [] };
};

export default App;
