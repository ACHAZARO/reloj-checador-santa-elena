/* frontend/admin.js */
const $ = (q) => document.querySelector(q);

function openAddModal(){ const m=$("#addModal"); if(m){ m.classList.remove("hidden"); $("#empNombre")?.focus(); } }
function closeAddModal(){ const m=$("#addModal"); if(m){ m.classList.add("hidden"); document.getElementById("addEmployeeForm")?.reset(); } }

document.addEventListener("DOMContentLoaded", () => {
  $("#fabAdd")?.addEventListener("click", openAddModal);
  $("#modalClose")?.addEventListener("click", closeAddModal);
  const overlay = $("#modalOverlay");
  overlay?.addEventListener("click", (e)=>{ if(e.target===overlay) closeAddModal(); });
  document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") closeAddModal(); });

  const form = document.getElementById("addEmployeeForm");
  if(!form) return;
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const payload = {
      nombre: $("#empNombre").value.trim(),
      pin: $("#empPin").value.trim(),
      salarioDiario: Number($("#empSalario").value),
      fechaIngreso: $("#empFecha").value,
      horasDiarias: Number($("#empHoras").value || 8),
      horarioEntrada: $("#empHoraIn").value || "09:00",
      horarioSalida: $("#empHoraOut").value || "17:00",
      diasLaborables: $("#empDias").value || "L, M, X, J, V"
    };
    if(!payload.nombre || !payload.pin || !payload.salarioDiario){
      alert("Nombre, PIN y Sueldo son obligatorios."); return;
    }
    try{
      const res = await fetch(`${window.API_URL||''}/api/empleados`, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if(!res.ok){ alert(data?.error || "Error creando empleado."); return; }
      alert("Empleado creado ✅");
      closeAddModal();
      if(typeof window.loadDay==="function") window.loadDay();
    }catch(err){ console.error(err); alert("No se pudo conectar con el servidor."); }
  });
});
