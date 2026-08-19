import React, { useState } from 'react';
import { Bike } from 'lucide-react';
import type { Driver } from '../../types';
import { useKitchenDrivers } from './KitchenDriversStore';
import { useKitchenToast } from './KitchenNotificationsStore';
import { Heading, Panel, Empty } from './KitchenPanels';

type DriverFormState = { name: string; phone: string; password: string; bikeModel: string; plate: string };

const emptyDriver: DriverFormState = { name: '', phone: '', password: '', bikeModel: '', plate: '' };

export const KitchenDriverPanel: React.FC = () => {
  const { drivers, createDriver, updateDriver, deleteDriver } = useKitchenDrivers();
  const triggerToast = useKitchenToast();
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [driverForm, setDriverForm] = useState<DriverFormState>(emptyDriver);
  const [driverModal, setDriverModal] = useState(false);
  const [driverToDelete, setDriverToDelete] = useState<Driver | null>(null);

  const openDriver = (driver?: Driver) => {
    setEditingDriver(driver || null);
    setDriverForm(
      driver
        ? {
            name: driver.name,
            phone: driver.phone || '',
            password: '',
            bikeModel: driver.bikeModel || '',
            plate: driver.plate || '',
          }
        : emptyDriver
    );
    setDriverModal(true);
  };

  const submitDriver = (event: React.FormEvent) => {
    event.preventDefault();
    if (!driverForm.name.trim()) return;
    if (editingDriver) {
      void updateDriver(editingDriver.id, {
        name: driverForm.name.trim(),
        phone: driverForm.phone.trim(),
        bikeModel: driverForm.bikeModel.trim(),
        plate: driverForm.plate.trim(),
        ...(driverForm.password.trim() ? { password: driverForm.password.trim() } : {}),
      });
    } else if (!driverForm.password.trim()) {
      triggerToast('Defina uma senha para o motoboy.');
      return;
    } else {
      void createDriver({ ...driverForm, name: driverForm.name.trim(), active: true });
    }
    setDriverModal(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><Heading icon={<Bike />} title="Motoboys" subtitle="Acessos e disponibilidade dos entregadores." /><button onClick={() => openDriver()} className="btn-primary">Novo motoboy</button></div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {drivers.map((driver) => (
          <Panel key={driver.id}>
            <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-[#1C1917] text-white flex items-center justify-center"><Bike className="w-5 h-5" /></div><div className="min-w-0 flex-1"><strong className="block truncate">{driver.name}</strong><span className="text-[11px] text-[#57534E]">{driver.phone || 'Sem telefone'}</span></div><span className={`text-[9px] font-black px-2 py-1 rounded-full ${driver.active ? 'bg-[#ECFDF5] text-[#059669]' : 'bg-[#FEF2F2] text-[#B91C1C]'}`}>{driver.online ? 'ONLINE' : driver.active ? 'ATIVO' : 'INATIVO'}</span></div>
            <div className="text-xs text-[#57534E] mt-3">{driver.bikeModel || 'Modelo não informado'} · {driver.plate || 'Sem placa'}</div>
            <div className="flex gap-2 mt-4"><button className="btn-secondary flex-1" onClick={() => openDriver(driver)}>Editar</button><button className="btn-secondary" onClick={() => void updateDriver(driver.id, { active: !driver.active })}>{driver.active ? 'Desativar' : 'Ativar'}</button><button className="btn-danger" onClick={() => setDriverToDelete(driver)}>Excluir</button></div>
          </Panel>
        ))}
        {drivers.length === 0 && <Empty text="Nenhum motoboy cadastrado." />}
      </div>
      {driverModal && <DriverModal editing={editingDriver} form={driverForm} setForm={setDriverForm} onClose={() => setDriverModal(false)} onSubmit={submitDriver} />}
      {driverToDelete && <Confirm title="Excluir motoboy?" text={`Remover ${driverToDelete.name} permanentemente?`} onClose={() => setDriverToDelete(null)} onConfirm={() => { void deleteDriver(driverToDelete.id); setDriverToDelete(null); }} />}
    </div>
  );
};

const DriverModal: React.FC<{ editing: Driver | null; form: DriverFormState; setForm: React.Dispatch<React.SetStateAction<DriverFormState>>; onClose: () => void; onSubmit: (event: React.FormEvent) => void }> = ({ editing, form, setForm, onClose, onSubmit }) => <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><form onSubmit={onSubmit} className="bg-white rounded-2xl p-5 w-full max-w-md space-y-3"><h3 className="font-extrabold text-lg">{editing ? 'Editar motoboy' : 'Novo motoboy'}</h3>{(['name', 'phone', 'password', 'bikeModel', 'plate'] as const).map((key) => <input key={key} type={key === 'password' ? 'password' : 'text'} required={key === 'name' || (!editing && key === 'password')} value={form[key]} onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))} placeholder={{ name: 'Nome', phone: 'Telefone', password: 'Senha', bikeModel: 'Modelo da moto', plate: 'Placa' }[key]} className="input" />)}<div className="flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancelar</button><button className="btn-primary flex-1">Salvar</button></div></form></div>;

const Confirm: React.FC<{ title: string; text: string; onClose: () => void; onConfirm: () => void }> = ({ title, text, onClose, onConfirm }) => <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3"><h3 className="font-extrabold">{title}</h3><p className="text-xs text-[#57534E]">{text}</p><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button><button className="btn-danger flex-1" onClick={onConfirm}>Excluir</button></div></div></div>;
