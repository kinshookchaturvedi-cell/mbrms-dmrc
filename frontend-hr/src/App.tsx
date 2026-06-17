import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';

const API_URL = 'http://localhost:4000';

function Login({ setToken }: any) {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await axios.post(`${API_URL}/auth/login`, { employeeId, password });
      if (data.role === 'employee') return alert('Access denied. HR/Admin only.');
      setToken(data.token);
      localStorage.setItem('hr_token', data.token);
      navigate('/');
    } catch (err) {
      alert('Login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 border border-gray-300 shadow-sm w-96">
        <h2 className="text-xl font-bold mb-6 text-center text-gray-800">HR Admin Portal</h2>
        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-semibold mb-1">HR ID</label>
            <input type="text" className="w-full border border-gray-400 px-3 py-2" value={employeeId} onChange={e => setEmployeeId(e.target.value)} />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-semibold mb-1">Password</label>
            <input type="password" className="w-full border border-gray-400 px-3 py-2" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="w-full bg-blue-900 text-white font-semibold py-2">Login</button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ token }: { token: string }) {
  const [claims, setClaims] = useState([]);
  const [selectedClaim, setSelectedClaim] = useState<any>(null);
  const [remarks, setRemarks] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');

  const fetchClaims = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/claims`, { headers: { Authorization: `Bearer ${token}` } });
      setClaims(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchClaims();
  }, []);

  const loadClaim = async (id: number) => {
    try {
      const { data } = await axios.get(`${API_URL}/claims/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setSelectedClaim(data);
      setApprovedAmount(data.totalAmount);
    } catch (err) {
      console.error(err);
    }
  };

  const updateStatus = async (status: string) => {
    try {
      await axios.patch(`${API_URL}/claims/${selectedClaim.id}/status`, { status, remarks, approvedAmount: Number(approvedAmount) }, { headers: { Authorization: `Bearer ${token}` } });
      alert('Status updated');
      setSelectedClaim(null);
      fetchClaims();
    } catch (err) {
      alert('Error updating status');
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="flex justify-between items-center bg-blue-900 text-white p-4 mb-6">
        <h1 className="text-xl font-bold">DMRC Claims Administration</h1>
        <button onClick={() => { localStorage.removeItem('hr_token'); window.location.reload(); }} className="text-sm underline">Logout</button>
      </div>

      <div className="flex gap-6">
        <div className="w-1/2 bg-white border border-gray-300">
          <h2 className="text-lg font-bold p-4 border-b">All Claims</h2>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-300">
                <th className="p-3 border-r border-gray-300 text-sm">Emp ID</th>
                <th className="p-3 border-r border-gray-300 text-sm">Amt</th>
                <th className="p-3 border-r border-gray-300 text-sm">Status</th>
                <th className="p-3 border-r border-gray-300 text-sm">Action</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c: any) => (
                <tr key={c.id} className="border-b border-gray-200">
                  <td className="p-3 border-r border-gray-200 text-sm">{c.employee?.employeeId}</td>
                  <td className="p-3 border-r border-gray-200 text-sm">₹{c.totalAmount}</td>
                  <td className="p-3 border-r border-gray-200 text-sm font-semibold">{c.status}</td>
                  <td className="p-3 border-r border-gray-200 text-sm">
                    <button onClick={() => loadClaim(c.id)} className="text-blue-700 underline">Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedClaim && (
          <div className="w-1/2 bg-white border border-gray-300 p-6">
            <h2 className="text-lg font-bold mb-4 border-b pb-2">Review Claim #{selectedClaim.id}</h2>
            <div className="mb-4 text-sm">
              <p><strong>Employee:</strong> {selectedClaim.employee.name} ({selectedClaim.employee.employeeId})</p>
              <p><strong>Requested Amount:</strong> ₹{selectedClaim.totalAmount}</p>
              <p><strong>Status:</strong> {selectedClaim.status}</p>
            </div>
            
            <div className="mb-4">
              <h3 className="font-bold border-b pb-1 mb-2 text-sm">Documents & OCR</h3>
              {selectedClaim.documents.map((d: any) => (
                <div key={d.id} className="mb-2 p-2 bg-gray-50 border border-gray-200 text-sm">
                  <a href={`${API_URL}${d.fileUrl}`} target="_blank" rel="noreferrer" className="text-blue-700 underline block mb-2">View Receipt</a>
                  <div>
                    <strong>Extracted Data:</strong>
                    <pre className="text-xs text-gray-700 bg-gray-100 p-2 mt-1">{JSON.stringify(d.extractedJson, null, 2)}</pre>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 mt-4">
              <div className="mb-3">
                <label className="block text-sm font-semibold mb-1">Approved Amount (₹)</label>
                <input type="number" className="border border-gray-400 w-full px-2 py-1" value={approvedAmount} onChange={e => setApprovedAmount(e.target.value)} />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-1">Remarks</label>
                <textarea className="border border-gray-400 w-full px-2 py-1" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}></textarea>
              </div>
              <div className="flex gap-2">
                <button onClick={() => updateStatus('APPROVED')} className="bg-green-700 text-white px-3 py-1 font-semibold">Approve</button>
                <button onClick={() => updateStatus('REJECTED')} className="bg-red-700 text-white px-3 py-1 font-semibold">Reject</button>
                <button onClick={() => updateStatus('NEEDS_CLARIFICATION')} className="bg-yellow-600 text-white px-3 py-1 font-semibold">Need Clarification</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('hr_token') || '');
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login setToken={setToken} />} />
        <Route path="/" element={token ? <Dashboard token={token} /> : <Login setToken={setToken} />} />
      </Routes>
    </BrowserRouter>
  );
}
