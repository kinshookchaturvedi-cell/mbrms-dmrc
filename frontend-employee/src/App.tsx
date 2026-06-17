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
      setToken(data.token);
      localStorage.setItem('token', data.token);
      navigate('/');
    } catch (err) {
      alert('Login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 border border-gray-300 shadow-sm w-96">
        <h2 className="text-xl font-bold mb-6 text-center text-gray-800">DMRC Employee Portal</h2>
        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-semibold mb-1">Employee ID</label>
            <input type="text" className="w-full border border-gray-400 px-3 py-2" value={employeeId} onChange={e => setEmployeeId(e.target.value)} />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-semibold mb-1">Password</label>
            <input type="password" className="w-full border border-gray-400 px-3 py-2" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="w-full bg-blue-800 text-white font-semibold py-2">Login</button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ token }: { token: string }) {
  const [claims, setClaims] = useState([]);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState('');

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return alert('Please attach a document');
    try {
      const { data: claim } = await axios.post(`${API_URL}/claims`, { totalAmount: Number(amount) }, { headers: { Authorization: `Bearer ${token}` } });
      const formData = new FormData();
      formData.append('document', file);
      await axios.post(`${API_URL}/claims/${claim.id}/documents`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      alert('Claim submitted successfully');
      fetchClaims();
      setFile(null);
      setAmount('');
    } catch (err) {
      alert('Error submitting claim');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex justify-between items-center bg-blue-800 text-white p-4 mb-6">
        <h1 className="text-xl font-bold">DMRC Medical Reimbursement</h1>
        <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="text-sm underline">Logout</button>
      </div>

      <div className="bg-white border border-gray-300 p-6 mb-6">
        <h2 className="text-lg font-bold mb-4 border-b pb-2">New Claim</h2>
        <form onSubmit={handleSubmit} className="flex gap-4 items-end">
          <div>
            <label className="block text-sm font-semibold mb-1">Total Amount (₹)</label>
            <input type="number" className="border border-gray-400 px-3 py-1 w-32" value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Receipt/Document</label>
            <input type="file" className="border border-gray-400 px-3 py-1" onChange={e => setFile(e.target.files?.[0] || null)} required />
          </div>
          <button type="submit" className="bg-blue-800 text-white px-4 py-1.5 font-semibold">Submit Claim</button>
        </form>
      </div>

      <div className="bg-white border border-gray-300">
        <h2 className="text-lg font-bold p-4 border-b">My Claims</h2>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              <th className="p-3 border-r border-gray-300 text-sm">ID</th>
              <th className="p-3 border-r border-gray-300 text-sm">Date</th>
              <th className="p-3 border-r border-gray-300 text-sm">Amount</th>
              <th className="p-3 border-r border-gray-300 text-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c: any) => (
              <tr key={c.id} className="border-b border-gray-200">
                <td className="p-3 border-r border-gray-200 text-sm">#{c.id}</td>
                <td className="p-3 border-r border-gray-200 text-sm">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="p-3 border-r border-gray-200 text-sm">₹{c.totalAmount}</td>
                <td className="p-3 border-r border-gray-200 text-sm font-semibold text-gray-700">{c.status}</td>
              </tr>
            ))}
            {claims.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-gray-500">No claims found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login setToken={setToken} />} />
        <Route path="/" element={token ? <Dashboard token={token} /> : <Login setToken={setToken} />} />
      </Routes>
    </BrowserRouter>
  );
}
