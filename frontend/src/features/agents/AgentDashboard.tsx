import React from 'react';
import { useAgents } from '../../api/agentApi';

export const AgentDashboard = () => {
    const { agents, loading, error } = useAgents();

    return (
        <div className="dashboard">
            {loading && <p>Loading agents...</p>}
            {error && <p>Error: {error.message}</p>}
            <div className="agent-grid">
                {agents.map(agent => (
                    <div key={agent.id} className="agent-card">
                        <h3>{agent.name}</h3>
                        <p>Status: {agent.status}</p>
                        <p>Last heartbeat: {agent.lastPing}</p>
                    </div>
                ))}
            </div>
        </div>
    );
};