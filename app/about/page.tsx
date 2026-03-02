"use client";

import { useState } from "react";

export default function Counter() {
    const [count, setCount] = useState(0);

    return (
        <div>
            <h1>カウント:{count}</h1>
            <button onClick={() => setCount(prev=>prev+1)}>増やす</button>
        </div>
    )
}