import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import PropTypes from "prop-types";
import createUseCacheCall from "./create-use-cache-call";
import createUseCacheCallPromise from "./create-use-cache-call-promise";
import createUseCacheEvents from "./create-use-cache-events";
import createUseCacheEventsPromise from "./create-use-cache-events-promise";
import createUseCacheSend from "./create-use-cache-send";
import debounce from "debounce";
import deepEqual from "deep-equal";
import { argsEqual } from "./args-equal.js";
import {
  createExpandedPromise,
  resolveOrReplaceExpandedPromise
} from "./expanded-promise.js";

const Context = createContext();
export const useDrizzle = () => useContext(Context);

const deepEqualStrict = (a, b) => deepEqual(a, b, { strict: true });

// Redux-like state selector.
// `mapState` should be a function that does the following:
// 1. Expects the current drizzleState as its first argument, a function, resolvePromise, as its second argument, any
// additional provided arguments in the args array as its 3rd, 4th, 5th, etc arguments.
// 2. It should use drizzeState and its additional arguments to extract any blockchain state that the it wants to
// extract.
// 3. If this state is already cahced in the drizzle state and ready to be returned, pass it to resolvePromise.
// 4. If it is not ready, do nothing.
//
// `args` is an optional argument that, if provided, can be an array of promises or non promises (or mixed). mapState
// will be called only when all promises in the array have been resolved. Each element of the array will be provided to
// mapState as a separate argument. Any promises will be replaced by their resolved value. If `args` changes, this will
// trigger a rerender. `args` changes are based on the individual elements. Promises are compared using a shallow
// comparison (by reference, essentially), and all other types are compared using the deep-equal package.
//
// Note: anytime `args` changes or mapState calls resolvePromise with a value that differs from the previous one, a new
// promise is returned and a rerender is triggered. This is how blockchain state changes are reflected by the promise.
//
// This is designed such that the output of useDrizzleStatePromise can be passed as part of an `args` array to a later
// call to useDrizzleState in order to effectively stage the calls so the output of one can be used as the input to the
// next.
export const useDrizzleStatePromise = (mapState, args) => {
  const { drizzle } = useDrizzle();

  // We keep a ref to `mapState` and always update it to avoid having a closure over it in the subscription that would make changes to it not have effect.
  const mapStateRef = useRef(mapState);
  mapStateRef.current = mapState;

  // Start args as null so they won't initially compare equal to undefined or any array the user provides.
  const argsRef = useRef(null);
  const argsPromiseRef = useRef();

  const [resultPromise, setResultPromise] = useState(createExpandedPromise());
  const setNewValueRef = useRef();
  setNewValueRef.current = useMemo(
    () => value =>
      resolveOrReplaceExpandedPromise(value, resultPromise, setResultPromise),
    [resultPromise]
  );

  // TODO: consider moving this to a useEffect().
  if (!argsEqual(argsRef.current, args)) {
    // Update the args ref and reset the args promise ref.
    argsRef.current = args;
    argsPromiseRef.current = createExpandedPromise();

    // Each time the arguments change, create a new promise and trigger a rerender to update all downstream deps.
    setResultPromise(createExpandedPromise());
    Promise.all(args === undefined ? [] : args).then(resolvedArgs => {
      if (!argsEqual(argsRef.current, args)) {
        // If the promises resolve only after the args have already changed, short circuit.
        return;
      }

      mapStateRef.current(
        drizzle.store.getState(),
        setNewValueRef.current,
        ...resolvedArgs
      );

      // Forward the resolution of the Promise.all on to the argsPromiseRef.
      argsPromiseRef.current.resolve(resolvedArgs);
    });
  }

  useEffect(() => {
    // Debounce udpates, because sometimes the store will fire too much when there are a lot of `cacheCall`s and the cache is empty.
    const debouncedHandler = debounce(() => {
      if (!argsPromiseRef.current.isResolved) {
        // Short circuit if it's not resolved - it will automatically update when the promise resolves.
        return;
      }

      argsPromiseRef.current.then(resolvedArgs => {
        // Should be called immediately since the promuse is resolved.
        mapStateRef.current(
          drizzle.store.getState(),
          setNewValueRef.current,
          ...resolvedArgs
        );
      });
    });

    const unsubscribe = drizzle.store.subscribe(debouncedHandler);
    return () => {
      unsubscribe();
      debouncedHandler.clear();
    };
  }, [drizzle.store]);
  return resultPromise;
};

// Redux-like state selector.
// `mapState` should be a function that takes the state of the drizzle store and returns only the part you need.
// The component will only rerender if this part changes.
// `args` is just an escape hatch to make the state update immediately when certain arguments change. `useCacheCall` uses it.
// It's useful when your `mapState` function depends on certain arguments and you don't want to wait for a `drizzle` store update when they change.
export const useDrizzleState = (mapState, args) => {
  const { drizzle } = useDrizzle();

  // We keep a ref to `mapState` and always update it to avoid having a closure over it in the subscription that would make changes to it not have effect.
  const mapStateRef = useRef(mapState);
  mapStateRef.current = mapState;

  // This is the escape hatch mentioned above. We keep a ref to `args` and whenever they change, we immediately update the state just like in the subscription.
  // This won't have any effect if `args` is undefined.
  const argsRef = useRef(args);
  const [state, setState] = useState(
    mapStateRef.current(drizzle.store.getState())
  );
  const stateRef = useRef(state);
  if (!deepEqualStrict(argsRef.current, args)) {
    argsRef.current = args;
    const newState = mapStateRef.current(drizzle.store.getState());
    if (!deepEqualStrict(stateRef.current, newState)) {
      stateRef.current = newState;
      setState(newState);
    }
  }
  useEffect(() => {
    // Debounce udpates, because sometimes the store will fire too much when there are a lot of `cacheCall`s and the cache is empty.
    const debouncedHandler = debounce(() => {
      const newState = mapStateRef.current(drizzle.store.getState());
      if (!deepEqualStrict(stateRef.current, newState)) {
        stateRef.current = newState;
        setState(newState);
      }
    });
    const unsubscribe = drizzle.store.subscribe(debouncedHandler);
    return () => {
      unsubscribe();
      debouncedHandler.clear();
    };
  }, [drizzle.store]);
  return stateRef.current;
};

export const DrizzleProvider = ({ children, drizzle }) => {
  const useCacheCall = useMemo(() => createUseCacheCall(drizzle), [drizzle]);
  const useCacheCallPromise = useMemo(
    () => createUseCacheCallPromise(drizzle),
    [drizzle]
  );
  const useCacheSend = useMemo(() => createUseCacheSend(drizzle), [drizzle]);
  const useCacheEvents = useMemo(() => createUseCacheEvents(drizzle), [
    drizzle
  ]);
  const useCacheEventsPromise = useMemo(
    () => createUseCacheEventsPromise(drizzle),
    [drizzle]
  );
  return (
    <Context.Provider
      value={useMemo(
        () => ({
          drizzle,
          useCacheCall,
          useCacheCallPromise,
          useCacheEvents,
          useCacheEventsPromise,
          useCacheSend
        }),
        [
          drizzle,
          useCacheCall,
          useCacheCallPromise,
          useCacheEvents,
          useCacheEventsPromise,
          useCacheSend
        ]
      )}
    >
      {children}
    </Context.Provider>
  );
};

DrizzleProvider.propTypes = {
  children: PropTypes.node.isRequired,
  drizzle: PropTypes.shape({}).isRequired
};

export * from "./components";
export { useRerenderOnResolution } from "./use-rerender-on-resolution";
export {
  createExpandedPromise,
  resolveOrReplaceExpandedPromise
} from "./expanded-promise";
